import assert from "node:assert/strict";
import test from "node:test";

import { createGenerationModeHandler } from "../src/bot/handlers/generation-mode.handler.js";
import { createStartHandler } from "../src/bot/handlers/start.handler.js";
import { GEMMA_ON_CALLBACK } from "../src/bot/messages.js";
import { silentLogger } from "./helpers.js";

test("/start asks the user to choose Gemma or direct mode", async () => {
  const replies = [];
  const chatEntries = [];
  const handler = createStartHandler({
    userDataService: {
      async getGemmaPreference() {
        return null;
      },
      async appendChat(entry) {
        chatEntries.push(entry);
      },
    },
    enhancementAvailable: true,
    logger: silentLogger,
  });
  const context = {
    update: { update_id: 10 },
    message: { text: "/start" },
    from: { id: 123, username: "owner", first_name: "Ali" },
    chat: { id: 123 },
    async reply(text, options) {
      replies.push({ text, options });
    },
  };

  await handler(context);

  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /No mode selected yet/);
  assert.deepEqual(
    replies[0].options.reply_markup.inline_keyboard[0].map((button) => button.callback_data),
    ["generation-mode:gemma", "generation-mode:direct"],
  );
  assert.deepEqual(
    chatEntries.map((entry) => entry.role),
    ["user", "assistant"],
  );
});

test("generation-mode callback saves the per-user Gemma preference", async () => {
  const calls = [];
  const activityEvents = [];
  const handler = createGenerationModeHandler({
    userDataService: {
      async setGemmaPreference(user, enabled) {
        calls.push({ type: "preference", user, enabled });
        return { updatedAt: "2026-11-08T07:00:00.000Z" };
      },
      async appendChat(entry) {
        calls.push({ type: "chat", entry });
      },
    },
    activityLogService: {
      async append(event) {
        activityEvents.push(event);
      },
    },
    enhancementAvailable: true,
    logger: silentLogger,
  });
  const context = {
    update: { update_id: 11 },
    callbackQuery: { data: GEMMA_ON_CALLBACK },
    from: { id: 123, username: "owner", first_name: "Ali" },
    chat: { id: 123 },
    async answerCbQuery(text) {
      calls.push({ type: "callback", text });
    },
    async editMessageText(text) {
      calls.push({ type: "edit", text });
    },
    async reply(text) {
      calls.push({ type: "reply", text });
    },
  };

  await handler(context);

  const preferenceCall = calls.find((call) => call.type === "preference");
  assert.equal(preferenceCall.user.id, "123");
  assert.equal(preferenceCall.enabled, true);
  assert.match(calls.find((call) => call.type === "edit").text, /Gemma: Enabled/);
  assert.match(calls.find((call) => call.type === "edit").text, /about 35 seconds/);
  assert.equal(activityEvents[0].event, "generation_mode_changed");
  assert.equal(activityEvents[0].gemmaEnabled, true);
});
