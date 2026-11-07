export function startChatAction({ telegram, chatId, intervalMs, logger }) {
  let stopped = false;

  const sendAction = async () => {
    try {
      await telegram.sendChatAction(chatId, "upload_document");
    } catch (error) {
      if (!stopped) {
        logger.warn("Could not update Telegram chat activity.", { error, chatId });
      }
    }
  };

  void sendAction();
  const timer = setInterval(() => void sendAction(), intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
