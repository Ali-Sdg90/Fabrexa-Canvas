import assert from "node:assert/strict";
import test from "node:test";

import {
  PromptEnhancementService,
  normalizeEnhancedPrompt,
} from "../src/services/prompt-enhancement.service.js";
import { PromptEnhancementError } from "../src/utils/errors.js";
import { silentLogger } from "./helpers.js";

function enhancementConfig(overrides = {}) {
  return {
    enabled: true,
    fallbackToRaw: false,
    maxOutputLength: 2400,
    systemPromptPath: "scene-director.txt",
    ...overrides,
  };
}

test("PromptEnhancementService uses the dedicated system prompt and original user input", async () => {
  let request;
  const ollamaService = {
    ensureReady: async () => ({ started: false, durationMs: 3 }),
    assertModelInstalled: async () => true,
    async generateScenePrompt(payload) {
      request = payload;
      return { content: "Prompt: two adults at a quiet night bus stop", metrics: {} };
    },
  };
  const service = new PromptEnhancementService(
    enhancementConfig(),
    ollamaService,
    silentLogger,
    {
      readPromptFile: async () => "You direct one coherent still image.",
      now: (() => {
        let value = 0;
        return () => {
          value += 10;
          return value;
        };
      })(),
    },
  );

  await service.initialize();
  const result = await service.enhance("A narrative bus-stop scene");

  assert.equal(request.systemPrompt, "You direct one coherent still image.");
  assert.match(request.userPrompt, /<user_input>\s*A narrative bus-stop scene\s*<\/user_input>/);
  assert.match(request.userPrompt, /preserve every explicit constraint/i);
  assert.equal(result.prompt, "two adults at a quiet night bus stop");
  assert.equal(result.enhanced, true);
});

test("normalizeEnhancedPrompt removes simple wrappers without truncating content", () => {
  assert.equal(
    normalizeEnhancedPrompt('```text\n"Prompt: A detailed visual scene"\n```', 100),
    "A detailed visual scene",
  );
});

test("normalizeEnhancedPrompt rejects empty, refusal, and oversized output", () => {
  assert.throws(() => normalizeEnhancedPrompt("   ", 100), PromptEnhancementError);
  assert.throws(
    () => normalizeEnhancedPrompt("Sorry, I cannot create that prompt.", 100),
    PromptEnhancementError,
  );
  assert.throws(() => normalizeEnhancedPrompt("x".repeat(101), 100), PromptEnhancementError);
});
