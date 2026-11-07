import assert from "node:assert/strict";
import test from "node:test";

import { ComfyUIService } from "../src/services/comfyui.service.js";
import {
  ComfyUiError,
  GenerationFailedError,
  GenerationTimeoutError,
  GpuHandoffError,
} from "../src/utils/errors.js";
import { createWorkflow, silentLogger, workflowMappings } from "./helpers.js";

function serviceConfig(overrides = {}) {
  return {
    baseUrl: "http://127.0.0.1:8188",
    workflowPath: "workflow.json",
    checkpointName: "private-checkpoint.safetensors",
    pollIntervalMs: 1,
    timeoutMs: 1000,
    requestTimeoutMs: 100,
    idleTimeoutMs: 1000,
    cleanupTimeoutMs: 1000,
    cleanupPollIntervalMs: 1,
    cleanupMinReleaseBytes: 64 * 1024 * 1024,
    cleanupFreeRatio: 0.7,
    cleanupStableSamples: 2,
    mappings: workflowMappings,
    ...overrides,
  };
}

test("ComfyUIService initializes from an API workflow and submits it", async () => {
  let submittedBody;
  const httpClient = {
    async post(path, body) {
      assert.equal(path, "/prompt");
      submittedBody = body;
      return { data: { prompt_id: "prompt-123" } };
    },
  };
  const service = new ComfyUIService(serviceConfig(), silentLogger, {
    httpClient,
    readWorkflowFile: async () => JSON.stringify(createWorkflow()),
    clientId: "client-123",
  });

  await service.initialize();
  const workflow = service.createWorkflow("A painted forest", 55);
  const promptId = await service.submitWorkflow(workflow);

  assert.equal(promptId, "prompt-123");
  assert.equal(submittedBody.client_id, "client-123");
  assert.equal(submittedBody.prompt["10"].inputs.text, "A painted forest");
  assert.equal(submittedBody.prompt["1"].inputs.ckpt_name, "private-checkpoint.safetensors");
  assert.equal(submittedBody.prompt["20"].inputs.seed, 55);
});

test("ComfyUIService rejects an invalid prompt submission response", async () => {
  const service = new ComfyUIService(serviceConfig(), silentLogger, {
    httpClient: { post: async () => ({ data: { node_errors: { 20: "invalid" } } }) },
  });

  await assert.rejects(
    () => service.submitWorkflow(createWorkflow()),
    (error) => error instanceof ComfyUiError && /prompt_id/.test(error.message),
  );
});

test("ComfyUIService polls history and returns a completed generation", async () => {
  let requestCount = 0;
  const completedHistory = {
    status: { completed: true, status_str: "success", messages: [] },
    outputs: { 40: { images: [{ filename: "result.png", type: "output" }] } },
  };
  const service = new ComfyUIService(serviceConfig(), silentLogger, {
    httpClient: {
      async get(path) {
        assert.equal(path, "/history/prompt-123");
        requestCount += 1;
        return requestCount === 1
          ? { data: {} }
          : { data: { "prompt-123": completedHistory } };
      },
    },
    sleep: async () => undefined,
  });

  assert.equal(await service.waitForCompletion("prompt-123"), completedHistory);
  assert.equal(requestCount, 2);
});

test("ComfyUIService detects execution failures", async () => {
  const service = new ComfyUIService(serviceConfig(), silentLogger, {
    httpClient: {
      async get() {
        return {
          data: {
            broken: {
              status: {
                completed: false,
                messages: [
                  ["execution_error", { exception_message: "CUDA allocation failed" }],
                ],
              },
            },
          },
        };
      },
    },
  });

  await assert.rejects(
    () => service.waitForCompletion("broken"),
    (error) => error instanceof GenerationFailedError && /CUDA allocation failed/.test(error.message),
  );
});

test("ComfyUIService times out when history never completes", async () => {
  let time = -1000;
  const service = new ComfyUIService(serviceConfig({ timeoutMs: 2500 }), silentLogger, {
    httpClient: { get: async () => ({ data: {} }) },
    sleep: async () => undefined,
    now: () => {
      time += 1000;
      return time;
    },
  });

  await assert.rejects(
    () => service.waitForCompletion("slow"),
    (error) => error instanceof GenerationTimeoutError,
  );
});

test("ComfyUIService downloads the image into memory without a filesystem copy", async () => {
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const service = new ComfyUIService(serviceConfig(), silentLogger, {
    httpClient: {
      async get(path, options) {
        assert.equal(path, "/view");
        assert.deepEqual(options.params, {
          filename: "result.png",
          subfolder: "Fabrexa",
          type: "output",
        });
        assert.equal(options.responseType, "arraybuffer");
        return { data: pngBytes, headers: { "content-type": "image/png" } };
      },
    },
  });

  const result = await service.downloadImage({
    filename: "result.png",
    subfolder: "Fabrexa",
    type: "output",
  });

  assert.equal(result.filename, "result.png");
  assert.deepEqual(result.buffer, pngBytes);
});

test("ComfyUIService unloads models only while idle and verifies released VRAM", async () => {
  const posts = [];
  let statsCalls = 0;
  const service = new ComfyUIService(serviceConfig(), silentLogger, {
    httpClient: {
      async get(path) {
        if (path === "/queue") {
          return { data: { queue_running: [], queue_pending: [] } };
        }
        if (path === "/system_stats") {
          statsCalls += 1;
          const freeBytes = statsCalls === 1 ? 2_000_000_000 : 7_000_000_000;
          return {
            data: {
              devices: [
                { name: "RTX 4060", type: "cuda", vram_total: 8_000_000_000, vram_free: freeBytes },
              ],
            },
          };
        }
        throw new Error(`Unexpected path: ${path}`);
      },
      async post(path, body) {
        posts.push({ path, body });
        return { data: {} };
      },
    },
    sleep: async () => undefined,
  });

  const result = await service.releaseModelsForExternalInference();

  assert.deepEqual(posts, [
    { path: "/free", body: { unload_models: true, free_memory: true } },
  ]);
  assert.equal(result.beforeFreeBytes, 2_000_000_000);
  assert.equal(result.afterFreeBytes, 7_000_000_000);
});

test("ComfyUIService does not request cleanup while another job stays active", async () => {
  let time = -500;
  let postCalls = 0;
  const service = new ComfyUIService(serviceConfig({ idleTimeoutMs: 1000 }), silentLogger, {
    httpClient: {
      get: async () => ({ data: { queue_running: [["manual-job"]], queue_pending: [] } }),
      post: async () => {
        postCalls += 1;
        return { data: {} };
      },
    },
    sleep: async () => undefined,
    now: () => {
      time += 500;
      return time;
    },
  });

  await assert.rejects(() => service.releaseModelsForExternalInference(), /remained busy/);
  assert.equal(postCalls, 0);
});

test("ComfyUIService fails when released VRAM cannot be verified before timeout", async () => {
  let time = -500;
  const service = new ComfyUIService(
    serviceConfig({ cleanupTimeoutMs: 1000, cleanupMinReleaseBytes: 64 * 1024 * 1024 }),
    silentLogger,
    {
      httpClient: {
        async get(path) {
          if (path === "/queue") {
            return { data: { queue_running: [], queue_pending: [] } };
          }
          return {
            data: {
              devices: [
                {
                  name: "RTX 4060",
                  type: "cuda",
                  vram_total: 8_000_000_000,
                  vram_free: 2_000_000_000,
                },
              ],
            },
          };
        },
        post: async () => ({ data: {} }),
      },
      sleep: async () => undefined,
      now: () => {
        time += 500;
        return time;
      },
    },
  );

  await assert.rejects(() => service.releaseModelsForExternalInference(), GpuHandoffError);
});
