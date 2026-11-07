import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { ActivityLogService } from "../src/services/activity-log.service.js";
import { ActivityLogError } from "../src/utils/errors.js";
import { silentLogger } from "./helpers.js";

test("ActivityLogService creates and serially updates a JSON activity file", async () => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "fabrexa-canvas-log-"));
  const filePath = path.join(temporaryDirectory, "data", "activity-log.json");
  const dates = [new Date("2026-11-07T07:00:00.000Z"), new Date("2026-11-07T07:01:00.000Z")];
  const service = new ActivityLogService({
    filePath,
    timeZone: "Asia/Tehran",
    logger: silentLogger,
    now: () => dates.shift(),
  });

  try {
    await service.initialize();
    assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), []);

    await Promise.all([
      service.append({ event: "start", user: { id: "123" } }),
      service.append({
        event: "image_generated",
        prompt: "A gothic castle",
        filename: "FabrexaCanvas_00001_.png",
      }),
    ]);

    const entries = JSON.parse(await readFile(filePath, "utf8"));
    assert.equal(entries.length, 2);
    assert.equal(entries[0].event, "start");
    assert.equal(entries[0].timestamp, "2026-11-07T07:00:00.000Z");
    assert.equal(entries[0].localTimestamp, "2026-11-07 10:30:00");
    assert.equal(entries[0].timeZone, "Asia/Tehran");
    assert.equal(entries[1].event, "image_generated");
    assert.equal(entries[1].prompt, "A gothic castle");
    assert.equal(entries[1].filename, "FabrexaCanvas_00001_.png");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("ActivityLogService refuses to overwrite an invalid existing log", async () => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "fabrexa-canvas-log-"));
  const filePath = path.join(temporaryDirectory, "activity-log.json");

  try {
    await writeFile(filePath, "not valid JSON", "utf8");
    const service = new ActivityLogService({
      filePath,
      timeZone: "Asia/Tehran",
      logger: silentLogger,
    });

    await assert.rejects(() => service.initialize(), ActivityLogError);
    assert.equal(await readFile(filePath, "utf8"), "not valid JSON");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
