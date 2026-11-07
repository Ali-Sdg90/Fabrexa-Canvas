import assert from "node:assert/strict";
import test from "node:test";

import { createAccessMiddleware, isAuthorizedUser } from "../src/bot/bot.js";
import { PRIVATE_BOT_MESSAGE } from "../src/bot/messages.js";

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
