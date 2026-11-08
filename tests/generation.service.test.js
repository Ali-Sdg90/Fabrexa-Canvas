import assert from "node:assert/strict";
import test from "node:test";

import { GenerationService } from "../src/services/generation.service.js";
import { PromptEnhancementError } from "../src/utils/errors.js";

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
    useGemma: false,
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

function successfulComfyUi(events) {
  return {
    createWorkflow(prompt, seed) {
      events.push(`comfy:create:${prompt}`);
      return { prompt, seed };
    },
    async submitWorkflow() {
      events.push("comfy:submit");
      return "prompt-1";
    },
    async waitForCompletion() {
      events.push("comfy:complete");
      return { outputs: {} };
    },
    getOutputImage() {
      return { filename: "result.png", type: "output" };
    },
    async downloadImage() {
      return { buffer: Buffer.from("png"), filename: "result.png" };
    },
  };
}

test("GenerationService bypasses Gemma when the account selects direct mode", async () => {
  const events = [];
  const service = new GenerationService({
    promptService,
    comfyUiService: successfulComfyUi(events),
    promptEnhancementService: {
      enabled: true,
      async enhance() {
        throw new Error("Gemma must not run for a direct request");
      },
    },
    gpuHandoffService: {
      prepareForLanguageModel() {
        throw new Error("GPU handoff must not run for a direct request");
      },
    },
  });

  const result = await service.generate({ prompt: "raw scene", seed: 42, useGemma: false });

  assert.equal(result.prompt, "raw scene");
  assert.equal(result.enhanced, false);
  assert.ok(events.includes("comfy:create:raw scene"));
});

test("GenerationService runs the full enhanced prompt pipeline inside one job", async () => {
  const events = [];
  const stages = [];
  const promptEnhancementService = {
    enabled: true,
    config: { fallbackToRaw: false },
    async enhance(originalPrompt) {
      events.push(`gemma:${originalPrompt}`);
      return {
        prompt: "enhanced visual prompt",
        enhanced: true,
        timings: { ollamaStartupMs: 4, gemmaInferenceMs: 20 },
        modelMetrics: { evalCount: 50 },
      };
    },
  };
  const gpuHandoffService = {
    async prepareForLanguageModel() {
      events.push("comfy:release");
      return { durationMs: 5 };
    },
    async runLanguageModelStage(task) {
      const inferenceResult = await task(new AbortController().signal);
      events.push("ollama:unload");
      return { inferenceResult, unloadResult: { durationMs: 3 } };
    },
    async prepareForImageGeneration() {
      events.push("comfy:ready");
      return { durationMs: 2 };
    },
  };
  const service = new GenerationService({
    promptService,
    comfyUiService: successfulComfyUi(events),
    promptEnhancementService,
    gpuHandoffService,
  });

  const result = await service.generate(
    { prompt: "raw story", seed: 42, useGemma: true },
    { onStage: async ({ stage }) => stages.push(stage) },
  );

  assert.equal(result.prompt, "enhanced visual prompt");
  assert.equal(result.originalPrompt, "raw story");
  assert.equal(result.enhanced, true);
  assert.ok(events.indexOf("comfy:release") < events.indexOf("gemma:raw story"));
  assert.ok(events.indexOf("ollama:unload") < events.indexOf("comfy:create:enhanced visual prompt"));
  assert.deepEqual(stages, ["preparing_scene", "preparing_image", "generating_image"]);
});

test("GenerationService can explicitly fall back only after a prompt-validation failure", async () => {
  const events = [];
  const service = new GenerationService({
    promptService,
    comfyUiService: successfulComfyUi(events),
    promptEnhancementService: {
      enabled: true,
      config: { fallbackToRaw: true },
      async enhance() {
        throw new PromptEnhancementError("invalid output");
      },
    },
    gpuHandoffService: {
      async prepareForLanguageModel() {
        return { durationMs: 1 };
      },
      async runLanguageModelStage(task) {
        return { inferenceResult: await task(), unloadResult: { durationMs: 1 } };
      },
      async prepareForImageGeneration() {
        return { durationMs: 1 };
      },
    },
  });

  const result = await service.generate({ prompt: "raw story", seed: 42, useGemma: true });

  assert.equal(result.prompt, "raw story");
  assert.equal(result.fallbackUsed, true);
  assert.ok(events.includes("comfy:create:raw story"));
});
