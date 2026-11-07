import assert from "node:assert/strict";
import test from "node:test";

import { GenerationService } from "../src/services/generation.service.js";

const promptService = Object.freeze({
  prepare(prompt) {
    return prompt.trim();
  },
});

test("GenerationService uses the configured fixed seed without generating a random one", () => {
  let randomSeedCalls = 0;
  const service = new GenerationService({
    promptService,
    comfyUiService: {},
    fixedSeed: 451905041881905,
    seedGenerator: () => {
      randomSeedCalls += 1;
      return 123;
    },
  });

  assert.deepEqual(service.prepareRequest(" A portrait "), {
    prompt: "A portrait",
    seed: 451905041881905,
  });
  assert.equal(randomSeedCalls, 0);
});

test("GenerationService generates a random seed when no fixed seed is configured", () => {
  const service = new GenerationService({
    promptService,
    comfyUiService: {},
    fixedSeed: null,
    seedGenerator: () => 987654321,
  });

  assert.equal(service.prepareRequest("A portrait").seed, 987654321);
});
