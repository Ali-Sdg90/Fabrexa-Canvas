import assert from "node:assert/strict";
import test from "node:test";

import { PromptService } from "../src/services/prompt.service.js";
import { PromptValidationError } from "../src/utils/errors.js";
import { UpdateDeduplicator } from "../src/utils/update-deduplicator.js";

test("PromptService passes valid user text through without enhancement", () => {
  const service = new PromptService({ maxLength: 100 });
  assert.equal(
    service.prepare("  A mysterious vampire queen inside a gothic castle.  "),
    "A mysterious vampire queen inside a gothic castle.",
  );
});

test("PromptService rejects empty and oversized prompts", () => {
  const service = new PromptService({ maxLength: 5 });
  assert.throws(() => service.prepare("   "), PromptValidationError);
  assert.throws(() => service.prepare("123456"), PromptValidationError);
});

test("PromptService accepts the configured 3500-character input limit", () => {
  const service = new PromptService({ maxLength: 3500 });

  assert.equal(service.prepare("x".repeat(3500)).length, 3500);
  assert.throws(() => service.prepare("x".repeat(3501)), PromptValidationError);
});

test("UpdateDeduplicator rejects repeated update IDs and expires old entries", () => {
  let currentTime = 1000;
  const deduplicator = new UpdateDeduplicator({
    ttlMs: 100,
    maxSize: 10,
    now: () => currentTime,
  });

  assert.equal(deduplicator.isDuplicate(10), false);
  assert.equal(deduplicator.isDuplicate(10), true);
  currentTime = 1101;
  assert.equal(deduplicator.isDuplicate(10), false);
});
