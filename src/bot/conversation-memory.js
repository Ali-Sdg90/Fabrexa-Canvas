import { telegramChatIdFromContext, telegramUserFromContext } from "../utils/telegram-user.js";

export async function recordChatSafely({
  userDataService,
  context,
  role,
  type,
  text,
  metadata,
  logger,
}) {
  try {
    await userDataService.appendChat({
      user: telegramUserFromContext(context),
      role,
      type,
      text,
      telegramUpdateId: context.update?.update_id ?? null,
      chatId: telegramChatIdFromContext(context),
      metadata,
    });
  } catch (error) {
    logger.error("Could not record Telegram conversation memory.", {
      error,
      chatId: context.chat?.id,
      role,
      type,
    });
  }
}
