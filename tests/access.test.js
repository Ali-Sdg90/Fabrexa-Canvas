import assert from "node:assert/strict";
import test from "node:test";

import {
  createAccessMiddleware,
  createStartLoggingMiddleware,
  isAuthorizedUser,
} from "../src/bot/bot.js";
import { PRIVATE_BOT_MESSAGE } from "../src/bot/messages.js";
import { silentLogger } from "./helpers.js";

test("isAuthorizedUser compares Telegram IDs without numeric coercion", () => {
  assert.equal(isAuthorizedUser({ from: { id: 123456789 } }, "123456789"), true);
  assert.equal(isAuthorizedUser({ from: { id: 987654321 } }, "123456789"), false);
  assert.equal(isAuthorizedUser({}, "123456789"), false);
});

test("access middleware allows the configured Telegram user", async () => {
  let nextCalled = false;
  const middleware = createAccessMiddleware("123456789");

  await middleware({ from: { id: 123456789 } }, async () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
});

test("access middleware rejects another Telegram user", async () => {
  let nextCalled = false;
  const replies = [];
  const middleware = createAccessMiddleware("123456789");

  await middleware(
    {
      from: { id: 222222222 },
      reply: async (message) => replies.push(message),
    },
    async () => {
      nextCalled = true;
    },
  );

  assert.equal(nextCalled, false);
  assert.deepEqual(replies, [PRIVATE_BOT_MESSAGE]);
});

test("start logging middleware records who started the bot before access control", async () => {
  const events = [];
  let nextCalled = false;
  const middleware = createStartLoggingMiddleware({
    activityLogService: {
      async append(event) {
        events.push(event);
      },
    },
    allowedUserId: "123456789",
    logger: silentLogger,
  });

  await middleware(
    {
      update: { update_id: 42 },
      message: { text: "/start welcome" },
      from: {
        id: 222222222,
        username: "visitor",
        first_name: "Test",
        last_name: "User",
      },
      chat: { id: 222222222 },
    },
    async () => {
      nextCalled = true;
    },
  );

  assert.equal(nextCalled, true);
  assert.deepEqual(events, [
    {
      event: "start",
      telegramUpdateId: 42,
      chatId: "222222222",
      user: {
        id: "222222222",
        username: "visitor",
        firstName: "Test",
        lastName: "User",
      },
      authorized: false,
    },
  ]);
});
