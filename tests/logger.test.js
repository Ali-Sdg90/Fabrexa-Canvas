import assert from "node:assert/strict";
import test from "node:test";

import { createLogger } from "../src/utils/logger.js";

test("logger redacts credential fields and configured secret values", () => {
  const records = [];
  const sink = {
    error(record) {
      records.push(record);
    },
  };
  const logger = createLogger({
    level: "info",
    sink,
    redactions: ["very-secret-token"],
  });

  logger.error("Telegram request failed.", {
    botToken: "very-secret-token",
    error: new Error("Request URL contained very-secret-token"),
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].includes("very-secret-token"), false);
  assert.equal(records[0].includes("[REDACTED]"), true);
});
