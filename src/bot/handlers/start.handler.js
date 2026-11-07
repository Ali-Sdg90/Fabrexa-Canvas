import { WELCOME_MESSAGE } from "../messages.js";

export function createStartHandler() {
  return async (context) => {
    await context.reply(WELCOME_MESSAGE);
  };
}
