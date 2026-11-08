import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { UserDataService } from "../src/services/user-data.service.js";
import { UserDataError } from "../src/utils/errors.js";
import { silentLogger } from "./helpers.js";

function telegramUser(id, username) {
  return { id, username, firstName: username, lastName: null };
}

test("UserDataService persists per-user preferences and aggregated chat memory", async () => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "fabrexa-canvas-users-"));
  const rootDirectory = path.join(temporaryDirectory, "data", "users");
  const globalMemoryPath = path.join(temporaryDirectory, "data", "global-memory.json");
  const dates = [
    new Date("2026-11-08T07:00:00.000Z"),
    new Date("2026-11-08T07:01:00.000Z"),
    new Date("2026-11-08T07:02:00.000Z"),
  ];
  let id = 0;
  const service = new UserDataService({
    rootDirectory,
    globalMemoryPath,
    timeZone: "Asia/Tehran",
    logger: silentLogger,
    now: () => dates.shift(),
    createId: () => `entry-${++id}`,
  });

  try {
    await service.initialize();
    assert.equal(await service.getGemmaPreference(telegramUser("123", "ali")), null);

    await service.setGemmaPreference(telegramUser("123", "ali"), true);
    assert.equal(await service.getGemmaPreference(telegramUser("123", "ali")), true);

    await Promise.all([
      service.appendChat({
        user: telegramUser("123", "ali"),
        role: "user",
        type: "prompt",
        text: "A moonlit castle",
        chatId: "123",
      }),
      service.appendChat({
        user: telegramUser("456", "sara"),
        role: "assistant",
        type: "generation_status",
        text: "Creating your image",
        chatId: "456",
      }),
    ]);

    const preferences = JSON.parse(
      await readFile(path.join(rootDirectory, "123", "preferences.json"), "utf8"),
    );
    const firstUserChats = JSON.parse(
      await readFile(path.join(rootDirectory, "123", "chats.json"), "utf8"),
    );
    const secondUserChats = JSON.parse(
      await readFile(path.join(rootDirectory, "456", "chats.json"), "utf8"),
    );
    const globalMemory = JSON.parse(await readFile(globalMemoryPath, "utf8"));

    assert.equal(preferences.gemmaEnabled, true);
    assert.equal(preferences.telegramUser.id, "123");
    assert.equal(firstUserChats.length, 1);
    assert.equal(secondUserChats.length, 1);
    assert.deepEqual(
      globalMemory.map((entry) => entry.id),
      ["entry-1", "entry-2"],
    );
    assert.equal(globalMemory[0].localTimestamp, "2026-11-08 10:31:00");
    assert.deepEqual(
      globalMemory.map((entry) => entry.user.id),
      ["123", "456"],
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("UserDataService refuses to overwrite invalid global memory", async () => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "fabrexa-canvas-users-"));
  const globalMemoryPath = path.join(temporaryDirectory, "global-memory.json");

  try {
    await writeFile(globalMemoryPath, "not valid JSON", "utf8");
    const service = new UserDataService({
      rootDirectory: path.join(temporaryDirectory, "users"),
      globalMemoryPath,
      timeZone: "Asia/Tehran",
      logger: silentLogger,
    });

    await assert.rejects(() => service.initialize(), UserDataError);
    assert.equal(await readFile(globalMemoryPath, "utf8"), "not valid JSON");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
