import { startChatAction } from "../chat-action.js";
import { telegramChatIdFromContext, telegramUserFromContext } from "../../utils/telegram-user.js";
import { recordChatSafely } from "../conversation-memory.js";
import {
  GEMMA_UNAVAILABLE_MESSAGE,
  MEDIA_ATTRIBUTION_HTML,
  PREFERENCE_REQUIRED_MESSAGE,
  UNKNOWN_COMMAND_MESSAGE,
  completedMessage,
  creatingMessage,
  preparingImageMessage,
  queuedMessage,
  understandingSceneMessage,
  userFacingError,
} from "../messages.js";

async function safelyEditStatus(context, statusMessage, text, logger, onEdited) {
  try {
    await context.telegram.editMessageText(
      statusMessage.chat.id,
      statusMessage.message_id,
      undefined,
      text,
      { parse_mode: "HTML" },
    );
    await onEdited?.(text);
  } catch (error) {
    logger.warn("Could not edit Telegram generation status.", {
      error,
      chatId: statusMessage.chat.id,
      messageId: statusMessage.message_id,
    });
  }
}

function startBackgroundTask(task, { logger, chatId }) {
  void task.catch((error) => {
    logger.error("Unexpected background generation error.", { error, chatId });
  });
}

export function createImageHandler({
  generationService,
  generationQueue,
  generationSettings,
  promptMaxLength,
  actionIntervalMs,
  activityLogService,
  userDataService,
  logger,
  backgroundTaskRunner = startBackgroundTask,
}) {
  return async (context) => {
    const rawPrompt = context.message?.text;
    const user = telegramUserFromContext(context);
    const record = (role, type, text, metadata) =>
      recordChatSafely({
        userDataService,
        context,
        role,
        type,
        text,
        metadata,
        logger,
      });

    await record("user", rawPrompt?.startsWith("/") ? "command" : "prompt", rawPrompt ?? "");

    if (rawPrompt?.startsWith("/")) {
      await context.reply(UNKNOWN_COMMAND_MESSAGE);
      await record("assistant", "error", UNKNOWN_COMMAND_MESSAGE);
      return;
    }

    const useGemma = await userDataService.getGemmaPreference(user);
    if (useGemma === null) {
      await context.reply(PREFERENCE_REQUIRED_MESSAGE);
      await record("assistant", "mode_required", PREFERENCE_REQUIRED_MESSAGE);
      return;
    }
    if (useGemma && !generationService.enhancementAvailable) {
      await context.reply(GEMMA_UNAVAILABLE_MESSAGE);
      await record("assistant", "error", GEMMA_UNAVAILABLE_MESSAGE);
      return;
    }

    let request;
    try {
      request = generationService.prepareRequest(rawPrompt, { useGemma });
    } catch (error) {
      const message = userFacingError(error, promptMaxLength);
      await context.reply(message);
      await record("assistant", "error", message);
      return;
    }

    const chatId = context.chat.id;
    const activityContext = {
      telegramUpdateId: context.update?.update_id ?? null,
      chatId: telegramChatIdFromContext(context),
      user: telegramUserFromContext(context),
    };

    try {
      await activityLogService.append({
        event: "prompt_received",
        ...activityContext,
        prompt: request.prompt,
        seed: request.seed,
        gemmaEnabled: request.useGemma,
      });
    } catch (error) {
      logger.error("Could not record the received prompt in the activity log.", {
        error,
        chatId,
      });
    }

    let statusMessage;
    let queueEntry;
    let releaseQueueTask;
    const statusReady = new Promise((resolve) => {
      releaseQueueTask = resolve;
    });

    try {
      queueEntry = generationQueue.add(
        async () => {
          const shouldRun = await statusReady;
          if (!shouldRun) {
            return null;
          }
          if (queueEntry.queued) {
            const activeMessage = request.useGemma
              ? understandingSceneMessage(request)
              : creatingMessage(request, generationSettings);
            await safelyEditStatus(
              context,
              statusMessage,
              activeMessage,
              logger,
              (text) => record("assistant", "generation_status", text),
            );
          }
          const stopChatAction = startChatAction({
            telegram: context.telegram,
            chatId,
            action: "typing",
            intervalMs: actionIntervalMs,
            logger,
          });
          try {
            return await generationService.generate(request, {
              onStage: async ({ stage, prompt }) => {
                if (!request.useGemma) {
                  return;
                }
                if (stage === "preparing_image") {
                  await safelyEditStatus(
                    context,
                    statusMessage,
                    preparingImageMessage(
                      { prompt, seed: request.seed, useGemma: request.useGemma },
                      generationSettings,
                    ),
                    logger,
                    (text) => record("assistant", "generation_status", text),
                  );
                }
                if (stage === "generating_image") {
                  await safelyEditStatus(
                    context,
                    statusMessage,
                    creatingMessage(
                      { prompt, seed: request.seed, useGemma: request.useGemma },
                      generationSettings,
                    ),
                    logger,
                    (text) => record("assistant", "generation_status", text),
                  );
                }
              },
            });
          } finally {
            stopChatAction();
          }
        },
        { chatId, telegramUserId: String(context.from.id) },
      );

      const initialText = queueEntry.queued
        ? queuedMessage(request, generationSettings, queueEntry.position)
        : request.useGemma
          ? understandingSceneMessage(request)
          : creatingMessage(request, generationSettings);
      statusMessage = await context.reply(initialText, { parse_mode: "HTML" });
      await record("assistant", "generation_status", initialText, {
        gemmaEnabled: request.useGemma,
        queuePosition: queueEntry.position,
      });
      releaseQueueTask(true);
    } catch (error) {
      releaseQueueTask?.(false);
      if (queueEntry) {
        void queueEntry.promise.catch((queueError) => {
          logger.debug("Cancelled a queued request without a Telegram status message.", {
            error: queueError,
            chatId,
          });
        });
      }
      const message = userFacingError(error, promptMaxLength);
      await context.reply(message);
      await record("assistant", "error", message);
      return;
    }

    const completionTask = (async () => {
      try {
        const result = await queueEntry.promise;
        try {
          await activityLogService.append({
            event: "image_generated",
            ...activityContext,
            originalPrompt: request.prompt,
            prompt: result.prompt,
            enhanced: result.enhanced,
            fallbackUsed: result.fallbackUsed,
            gemmaEnabled: request.useGemma,
            seed: request.seed,
            promptId: result.promptId,
            filename: result.filename,
            durationMs: result.durationMs,
            timings: result.timings,
          });
        } catch (error) {
          logger.error("Could not record the generated image in the activity log.", {
            error,
            chatId,
            promptId: result.promptId,
          });
        }

        await safelyEditStatus(
          context,
          statusMessage,
          completedMessage(
            { prompt: result.prompt, seed: request.seed, useGemma: request.useGemma },
            generationSettings,
            result.durationMs,
          ),
          logger,
          (text) => record("assistant", "generation_complete", text),
        );
        const mediaCaption = {
          caption: MEDIA_ATTRIBUTION_HTML,
          parse_mode: "HTML",
        };
        try {
          await context.telegram.sendChatAction(chatId, "upload_photo");
        } catch (error) {
          logger.warn("Could not set Telegram photo-upload activity.", {
            error,
            chatId,
          });
        }
        await context.replyWithPhoto({ source: result.buffer }, mediaCaption);
        await record("assistant", "image", MEDIA_ATTRIBUTION_HTML, {
          filename: result.filename,
          promptId: result.promptId,
          gemmaEnabled: request.useGemma,
        });
        logger.info("Generated image delivered to Telegram as a photo.", {
          chatId,
          promptId: result.promptId,
          filename: result.filename,
          durationMs: result.durationMs,
        });
      } catch (error) {
        logger.error("Image generation request failed.", { error, chatId });
        const message = userFacingError(error, promptMaxLength);
        await safelyEditStatus(
          context,
          statusMessage,
          message,
          logger,
          (text) => record("assistant", "error", text),
        );
      }
    })();

    backgroundTaskRunner(completionTask, { logger, chatId });
  };
}
