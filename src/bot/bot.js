import { Telegraf } from "telegraf";

import { UpdateDeduplicator } from "../utils/update-deduplicator.js";
import { createImageHandler } from "./handlers/image.handler.js";
import { createStartHandler } from "./handlers/start.handler.js";
import { PRIVATE_BOT_MESSAGE, TEXT_ONLY_MESSAGE } from "./messages.js";

export function isAuthorizedUser(context, allowedUserId) {
  return context.from?.id != null && String(context.from.id) === String(allowedUserId);
}

export function createAccessMiddleware(allowedUserId) {
  return async (context, next) => {
    if (!isAuthorizedUser(context, allowedUserId)) {
      if (typeof context.reply === "function") {
        await context.reply(PRIVATE_BOT_MESSAGE);
      }
      return;
    }
    return next();
  };
}

export function createDeduplicationMiddleware(deduplicator, logger) {
  return async (context, next) => {
    if (deduplicator.isDuplicate(context.update?.update_id)) {
      logger.warn("Duplicate Telegram update ignored.", {
        updateId: context.update?.update_id,
      });
      return;
    }
    return next();
  };
}

export function createBot({ config, generationService, generationQueue, logger, botFactory }) {
  const bot = botFactory ? botFactory(config.telegram.botToken) : new Telegraf(config.telegram.botToken);
  const deduplicator = new UpdateDeduplicator({
    ttlMs: config.updates.dedupTtlMs,
    maxSize: config.updates.dedupMaxSize,
  });

  bot.use(createDeduplicationMiddleware(deduplicator, logger));
  bot.use(createAccessMiddleware(config.telegram.allowedUserId));
  bot.start(createStartHandler());
  bot.on(
    "text",
    createImageHandler({
      generationService,
      generationQueue,
      generationSettings: config.generation,
      promptMaxLength: config.prompt.maxLength,
      actionIntervalMs: config.telegram.actionIntervalMs,
      logger,
    }),
  );
  bot.on("message", async (context) => {
    await context.reply(TEXT_ONLY_MESSAGE);
  });

  bot.catch(async (error, context) => {
    logger.error("Unhandled Telegram update error.", {
      error,
      updateId: context.update?.update_id,
      chatId: context.chat?.id,
    });
    try {
      await context.reply("Something went wrong while handling that message. Please try again.");
    } catch (replyError) {
      logger.error("Could not send Telegram error response.", { error: replyError });
    }
  });

  return bot;
}
