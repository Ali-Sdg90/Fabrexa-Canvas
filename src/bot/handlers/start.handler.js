import { telegramUserFromContext } from "../../utils/telegram-user.js";
import { recordChatSafely } from "../conversation-memory.js";
import {
  GEMMA_OFF_CALLBACK,
  GEMMA_ON_CALLBACK,
  welcomeMessage,
} from "../messages.js";

export function generationModeKeyboard({ gemmaAvailable = true } = {}) {
  const buttons = [];
  if (gemmaAvailable) {
    buttons.push({ text: "✨ Use Gemma", callback_data: GEMMA_ON_CALLBACK });
  }
  buttons.push({ text: "⚡ Direct mode", callback_data: GEMMA_OFF_CALLBACK });

  return { inline_keyboard: [buttons] };
}

export function createStartHandler({ userDataService, enhancementAvailable, logger }) {
  return async (context) => {
    const user = telegramUserFromContext(context);
    const currentPreference = await userDataService.getGemmaPreference(user);
    const message = welcomeMessage(currentPreference, {
      gemmaAvailable: enhancementAvailable,
    });

    await recordChatSafely({
      userDataService,
      context,
      role: "user",
      type: "command",
      text: context.message?.text ?? "/start",
      logger,
    });
    await context.reply(message, {
      reply_markup: generationModeKeyboard({ gemmaAvailable: enhancementAvailable }),
    });
    await recordChatSafely({
      userDataService,
      context,
      role: "assistant",
      type: "mode_selection",
      text: message,
      metadata: { currentPreference, enhancementAvailable },
      logger,
    });
  };
}
