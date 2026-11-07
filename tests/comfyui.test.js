import assert from "node:assert/strict";
import test from "node:test";

import { ComfyUIService } from "../src/services/comfyui.service.js";
import {
  ComfyUiError,
  GenerationFailedError,
  GenerationTimeoutError,
} from "../src/utils/errors.js";
import { createWorkflow, silentLogger, workflowMappings } from "./helpers.js";

function serviceConfig(overrides = {}) {
  return {
    baseUrl: "http://127.0.0.1:8188",
    workflowPath: "workflow.json",
    pollIntervalMs: 1,
    timeoutMs: 1000,
    requestTimeoutMs: 100,
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
