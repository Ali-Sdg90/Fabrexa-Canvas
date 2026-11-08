import { Telegraf } from "telegraf";

import { UpdateDeduplicator } from "../utils/update-deduplicator.js";
import { telegramChatIdFromContext, telegramUserFromContext } from "../utils/telegram-user.js";
import { recordChatSafely } from "./conversation-memory.js";
import { createGenerationModeHandler } from "./handlers/generation-mode.handler.js";
import { createImageHandler } from "./handlers/image.handler.js";
import { createStartHandler } from "./handlers/start.handler.js";
import {
  GEMMA_OFF_CALLBACK,
  GEMMA_ON_CALLBACK,
  PRIVATE_BOT_MESSAGE,
  TEXT_ONLY_MESSAGE,
} from "./messages.js";

export function isAuthorizedUser(context, allowedUserIds) {
  const normalizedIds = Array.isArray(allowedUserIds) ? allowedUserIds : [allowedUserIds];
  return (
    context.from?.id != null &&
    normalizedIds.some((allowedUserId) => String(context.from.id) === String(allowedUserId))
  );
}

export function createAccessMiddleware(allowedUserIds) {
  return async (context, next) => {
    if (!isAuthorizedUser(context, allowedUserIds)) {
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

function isStartCommand(context) {
  const firstToken = context.message?.text?.trim().split(/\s+/, 1)[0];
  return typeof firstToken === "string" && /^\/start(?:@[a-z0-9_]+)?$/i.test(firstToken);
}

export function createStartLoggingMiddleware({ activityLogService, allowedUserIds, logger }) {
  return async (context, next) => {
    if (isStartCommand(context)) {
      try {
        await activityLogService.append({
          event: "start",
          telegramUpdateId: context.update?.update_id ?? null,
          chatId: telegramChatIdFromContext(context),
          user: telegramUserFromContext(context),
          authorized: isAuthorizedUser(context, allowedUserIds),
        });
      } catch (error) {
        logger.error("Could not record the Telegram start event.", {
          error,
          chatId: context.chat?.id,
        });
      }
    }
    return next();
  };
}

export function createBot({
  config,
  generationService,
  generationQueue,
  activityLogService,
  userDataService,
  logger,
  botFactory,
}) {
  const bot = botFactory ? botFactory(config.telegram.botToken) : new Telegraf(config.telegram.botToken);
  const deduplicator = new UpdateDeduplicator({
    ttlMs: config.updates.dedupTtlMs,
    maxSize: config.updates.dedupMaxSize,
  });

  bot.use(createDeduplicationMiddleware(deduplicator, logger));
  bot.use(
    createStartLoggingMiddleware({
      activityLogService,
      allowedUserIds: config.telegram.allowedUserIds,
      logger,
    }),
  );
  bot.use(createAccessMiddleware(config.telegram.allowedUserIds));
  bot.start(
    createStartHandler({
      userDataService,
      enhancementAvailable: generationService.enhancementAvailable,
      logger,
    }),
  );
  const generationModeHandler = createGenerationModeHandler({
    userDataService,
    activityLogService,
    enhancementAvailable: generationService.enhancementAvailable,
    logger,
  });
  bot.action(GEMMA_ON_CALLBACK, generationModeHandler);
  bot.action(GEMMA_OFF_CALLBACK, generationModeHandler);
  bot.on(
    "text",
    createImageHandler({
      generationService,
      generationQueue,
      generationSettings: config.generation,
      promptMaxLength: config.prompt.maxLength,
      actionIntervalMs: config.telegram.actionIntervalMs,
      activityLogService,
      userDataService,
      logger,
    }),
  );
  bot.on("message", async (context) => {
    await recordChatSafely({
      userDataService,
      context,
      role: "user",
      type: "unsupported_message",
      text: "[Non-text Telegram message]",
      logger,
    });
    await context.reply(TEXT_ONLY_MESSAGE);
    await recordChatSafely({
      userDataService,
      context,
      role: "assistant",
      type: "error",
      text: TEXT_ONLY_MESSAGE,
      logger,
    });
  });

  bot.catch(async (error, context) => {
    logger.error("Unhandled Telegram update error.", {
      error,
      updateId: context.update?.update_id,
      chatId: context.chat?.id,
    });
    try {
      const message = "Something went wrong while handling that message. Please try again.";
      await context.reply(message);
      if (isAuthorizedUser(context, config.telegram.allowedUserIds)) {
        await recordChatSafely({
          userDataService,
          context,
          role: "assistant",
          type: "error",
          text: message,
          logger,
        });
      }
    } catch (replyError) {
      logger.error("Could not send Telegram error response.", { error: replyError });
    }
  });

  return bot;
}
