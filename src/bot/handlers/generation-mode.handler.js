import { telegramChatIdFromContext, telegramUserFromContext } from "../../utils/telegram-user.js";
import { recordChatSafely } from "../conversation-memory.js";
import {
  GEMMA_OFF_CALLBACK,
  GEMMA_ON_CALLBACK,
  GEMMA_UNAVAILABLE_MESSAGE,
  preferenceSavedMessage,
} from "../messages.js";

async function answerCallback(context, text, logger) {
  try {
    await context.answerCbQuery(text);
  } catch (error) {
    logger.warn("Could not answer Telegram generation-mode callback.", {
      error,
      chatId: context.chat?.id,
    });
  }
}

async function replaceSelectionMessage(context, message, logger) {
  try {
    await context.editMessageText(message);
  } catch (error) {
    logger.warn("Could not edit the Telegram mode-selection message; sending a new reply.", {
      error,
      chatId: context.chat?.id,
    });
    await context.reply(message);
  }
}

export function createGenerationModeHandler({
  userDataService,
  activityLogService,
  enhancementAvailable,
  logger,
}) {
  return async (context) => {
    const callbackData = context.callbackQuery?.data;
    const gemmaEnabled = callbackData === GEMMA_ON_CALLBACK;
    if (!gemmaEnabled && callbackData !== GEMMA_OFF_CALLBACK) {
      return;
    }

    if (gemmaEnabled && !enhancementAvailable) {
      await answerCallback(context, "Gemma is unavailable", logger);
      await context.reply(GEMMA_UNAVAILABLE_MESSAGE);
      await recordChatSafely({
        userDataService,
        context,
        role: "assistant",
        type: "error",
        text: GEMMA_UNAVAILABLE_MESSAGE,
        logger,
      });
      return;
    }

    const user = telegramUserFromContext(context);
    const preference = await userDataService.setGemmaPreference(user, gemmaEnabled);
    const message = preferenceSavedMessage(gemmaEnabled);

    await answerCallback(context, gemmaEnabled ? "Gemma enabled" : "Direct mode enabled", logger);
    await replaceSelectionMessage(context, message, logger);
    await recordChatSafely({
      userDataService,
      context,
      role: "user",
      type: "preference",
      text: gemmaEnabled ? "Enable Gemma" : "Disable Gemma",
      metadata: { gemmaEnabled },
      logger,
    });
    await recordChatSafely({
      userDataService,
      context,
      role: "assistant",
      type: "preference_confirmation",
      text: message,
      metadata: { gemmaEnabled },
      logger,
    });

    try {
      await activityLogService.append({
        event: "generation_mode_changed",
        telegramUpdateId: context.update?.update_id ?? null,
        chatId: telegramChatIdFromContext(context),
        user,
        gemmaEnabled,
        preferenceUpdatedAt: preference.updatedAt,
      });
    } catch (error) {
      logger.error("Could not record the generation-mode change in the activity log.", {
        error,
        chatId: context.chat?.id,
      });
    }
  };
}
