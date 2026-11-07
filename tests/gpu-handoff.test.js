import assert from "node:assert/strict";
import test from "node:test";

import { GpuHandoffService } from "../src/services/gpu-handoff.service.js";
import { GpuHandoffError } from "../src/utils/errors.js";
import { silentLogger } from "./helpers.js";

test("GpuHandoffService keeps ComfyUI idle through inference and verified Ollama unload", async () => {
  const events = [];
  const service = new GpuHandoffService(
    {
      comfyUiService: {
        async releaseModelsForExternalInference() {
          events.push("comfy:release");
          return { durationMs: 10 };
        },
        async getQueueState() {
          events.push("comfy:inspect");
          return { idle: true };
        },
        async waitUntilIdle() {
          events.push("comfy:ready");
          return { durationMs: 2 };
        },
      },
      ollamaService: {
        async unloadConfiguredModelAndWait() {
          events.push("ollama:unload");
          return { durationMs: 3 };
        },
      },
      pollIntervalMs: 1,
      logger: silentLogger,
    },
    {
      sleep: async () =>
        new Promise((resolve) => {
          setTimeout(resolve, 0);
        }),
    },
  );

  await service.prepareForLanguageModel();
  const stage = await service.runLanguageModelStage(async () => {
    events.push("ollama:infer");
    return { prompt: "enhanced" };
  });
  await service.prepareForImageGeneration();

  assert.equal(stage.inferenceResult.prompt, "enhanced");
  assert.ok(events.indexOf("comfy:release") < events.indexOf("ollama:infer"));
  assert.ok(events.indexOf("ollama:infer") < events.indexOf("ollama:unload"));
  assert.ok(events.indexOf("ollama:unload") < events.indexOf("comfy:ready"));
});

test("GpuHandoffService aborts inference and still unloads Ollama if ComfyUI becomes busy", async () => {
  let queueChecks = 0;
  let unloadCalls = 0;
  const service = new GpuHandoffService(
    {
      comfyUiService: {
        async getQueueState() {
          queueChecks += 1;
          return { idle: queueChecks === 1 };
        },
      },
      ollamaService: {
        async unloadConfiguredModelAndWait() {
          unloadCalls += 1;
          return { durationMs: 1 };
        },
      },
      pollIntervalMs: 1,
      logger: silentLogger,
    },
    { sleep: async () => undefined },
  );

  await assert.rejects(
    () =>
      service.runLanguageModelStage(
        (signal) =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 1000);
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(signal.reason);
              },
              { once: true },
            );
          }),
      ),
    GpuHandoffError,
  );
  assert.equal(unloadCalls, 1);
});

test("GpuHandoffService blocks ComfyUI when Ollama unload fails", async () => {
  let prepareImageCalls = 0;
  const service = new GpuHandoffService(
    {
      comfyUiService: {
        async getQueueState() {
          return { idle: true };
        },
        async waitUntilIdle() {
          prepareImageCalls += 1;
          return { durationMs: 1 };
        },
      },
      ollamaService: {
        async unloadConfiguredModelAndWait() {
          throw new Error("still resident");
        },
      },
      pollIntervalMs: 1,
      logger: silentLogger,
    },
    {
      sleep: async () =>
        new Promise((resolve) => {
          setTimeout(resolve, 0);
        }),
    },
  );

  await assert.rejects(
    () => service.runLanguageModelStage(async () => ({ prompt: "enhanced" })),
    GpuHandoffError,
  );
  assert.equal(prepareImageCalls, 0);
});
