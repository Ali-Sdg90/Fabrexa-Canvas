import { startChatAction } from "../chat-action.js";
import { telegramChatIdFromContext, telegramUserFromContext } from "../../utils/telegram-user.js";
import {
  MEDIA_ATTRIBUTION_HTML,
  UNKNOWN_COMMAND_MESSAGE,
  completedMessage,
  creatingMessage,
  preparingImageMessage,
  queuedMessage,
  understandingSceneMessage,
  userFacingError,
} from "../messages.js";

async function safelyEditStatus(context, statusMessage, text, logger) {
  try {
    await context.telegram.editMessageText(
      statusMessage.chat.id,
      statusMessage.message_id,
      undefined,
      text,
      { parse_mode: "HTML" },
    );
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
  logger,
  backgroundTaskRunner = startBackgroundTask,
}) {
  return async (context) => {
    const rawPrompt = context.message?.text;
    if (rawPrompt?.startsWith("/")) {
      await context.reply(UNKNOWN_COMMAND_MESSAGE);
      return;
    }

    let request;
    try {
      request = generationService.prepareRequest(rawPrompt);
    } catch (error) {
      await context.reply(userFacingError(error, promptMaxLength));
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
            const activeMessage = generationService.enhancementEnabled
              ? understandingSceneMessage(request)
              : creatingMessage(request, generationSettings);
            await safelyEditStatus(
              context,
              statusMessage,
              activeMessage,
              logger,
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
                if (!generationService.enhancementEnabled) {
                  return;
                }
                if (stage === "preparing_image") {
                  await safelyEditStatus(
                    context,
                    statusMessage,
                    preparingImageMessage({ prompt, seed: request.seed }, generationSettings),
                    logger,
                  );
                }
                if (stage === "generating_image") {
                  await safelyEditStatus(
                    context,
                    statusMessage,
                    creatingMessage(
                      { prompt, seed: request.seed },
                      generationSettings,
                      { includeEstimate: false },
                    ),
                    logger,
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
        : generationService.enhancementEnabled
          ? understandingSceneMessage(request)
          : creatingMessage(request, generationSettings);
      statusMessage = await context.reply(initialText, { parse_mode: "HTML" });
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
      await context.reply(userFacingError(error, promptMaxLength));
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
            { prompt: result.prompt, seed: request.seed },
            generationSettings,
            result.durationMs,
          ),
          logger,
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
        logger.info("Generated image delivered to Telegram as a photo.", {
          chatId,
          promptId: result.promptId,
          filename: result.filename,
          durationMs: result.durationMs,
        });
      } catch (error) {
        logger.error("Image generation request failed.", { error, chatId });
        await safelyEditStatus(
          context,
          statusMessage,
          userFacingError(error, promptMaxLength),
          logger,
        );
      }
    })();

    backgroundTaskRunner(completionTask, { logger, chatId });
  };
}
