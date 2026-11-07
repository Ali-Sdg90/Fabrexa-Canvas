import { startChatAction } from "../chat-action.js";
import {
  IMAGE_CAPTION,
  UNKNOWN_COMMAND_MESSAGE,
  completedMessage,
  creatingMessage,
  queuedMessage,
  userFacingError,
} from "../messages.js";

async function safelyEditStatus(context, statusMessage, text, logger) {
  try {
    await context.telegram.editMessageText(
      statusMessage.chat.id,
      statusMessage.message_id,
      undefined,
      text,
    );
  } catch (error) {
    logger.warn("Could not edit Telegram generation status.", {
      error,
      chatId: statusMessage.chat.id,
      messageId: statusMessage.message_id,
    });
  }
}

export function createImageHandler({
  generationService,
  generationQueue,
  generationSettings,
  promptMaxLength,
  actionIntervalMs,
  logger,
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
            await safelyEditStatus(
              context,
              statusMessage,
              creatingMessage(request, generationSettings),
              logger,
            );
          }
          const stopChatAction = startChatAction({
            telegram: context.telegram,
            chatId,
            intervalMs: actionIntervalMs,
            logger,
          });
          try {
            return await generationService.generate(request);
          } finally {
            stopChatAction();
          }
        },
        { chatId, telegramUserId: String(context.from.id) },
      );

      const initialText = queueEntry.queued
        ? queuedMessage(request, generationSettings, queueEntry.position)
        : creatingMessage(request, generationSettings);
      statusMessage = await context.reply(initialText);
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

    try {
      const result = await queueEntry.promise;
      await safelyEditStatus(
        context,
        statusMessage,
        completedMessage(request, generationSettings, result.durationMs),
        logger,
      );
      await context.replyWithDocument(
        { source: result.buffer, filename: result.filename },
        { caption: IMAGE_CAPTION },
      );
      logger.info("Generated image delivered to Telegram.", {
        chatId,
        promptId: result.promptId,
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
  };
}
