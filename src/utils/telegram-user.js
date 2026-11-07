export function telegramUserFromContext(context) {
  return Object.freeze({
    id: context.from?.id == null ? null : String(context.from.id),
    username: context.from?.username ?? null,
    firstName: context.from?.first_name ?? null,
    lastName: context.from?.last_name ?? null,
  });
}

export function telegramChatIdFromContext(context) {
  return context.chat?.id == null ? null : String(context.chat.id);
}
