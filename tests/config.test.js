import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config/index.js";
import { ConfigError } from "../src/utils/errors.js";

function validEnvironment(overrides = {}) {
  return {
    TELEGRAM_BOT_TOKEN: "123456:test-token",
    ALLOWED_TELEGRAM_USER_ID: "123456789",
    COMFYUI_BASE_URL: "http://127.0.0.1:8188",
    COMFYUI_WORKFLOW_PATH: "./workflow.json",
    COMFYUI_POSITIVE_PROMPT_NODE_ID: "10",
    COMFYUI_POSITIVE_PROMPT_INPUT: "text",
    COMFYUI_SEED_NODE_ID: "20",
    COMFYUI_SEED_INPUT: "seed",
    COMFYUI_SAVE_IMAGE_NODE_ID: "40",
    ...overrides,
  };
}

test("loadConfig validates and normalizes a complete environment", () => {
  const config = loadConfig(validEnvironment(), { cwd: process.cwd() });

  assert.equal(config.telegram.allowedUserId, "123456789");
  assert.equal(config.comfyUi.baseUrl, "http://127.0.0.1:8188");
  assert.equal(config.comfyUi.pollIntervalMs, 2000);
  assert.equal(config.comfyUi.mappings.positivePromptNodeId, "10");
  assert.equal(config.generation.width, 832);
  assert.equal(config.generation.height, 1152);
});

test("loadConfig rejects missing secrets and mappings", () => {
  assert.throws(
    () => loadConfig(validEnvironment({ TELEGRAM_BOT_TOKEN: "" })),
    (error) => error instanceof ConfigError && /TELEGRAM_BOT_TOKEN/.test(error.message),
  );
  assert.throws(
    () => loadConfig(validEnvironment({ COMFYUI_SEED_NODE_ID: "" })),
    (error) => error instanceof ConfigError && /COMFYUI_SEED_NODE_ID/.test(error.message),
  );
});

test("loadConfig rejects a non-loopback ComfyUI endpoint", () => {
  assert.throws(
    () => loadConfig(validEnvironment({ COMFYUI_BASE_URL: "https://example.com:8188" })),
    (error) => error instanceof ConfigError && /loopback/.test(error.message),
  );
});

test("loadConfig rejects invalid numeric limits", () => {
  assert.throws(
    () => loadConfig(validEnvironment({ GENERATION_QUEUE_MAX_SIZE: "unlimited" })),
    (error) => error instanceof ConfigError && /whole number/.test(error.message),
  );
});
