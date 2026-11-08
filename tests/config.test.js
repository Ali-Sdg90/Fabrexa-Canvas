import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "../src/config/index.js";
import { ConfigError } from "../src/utils/errors.js";

function validEnvironment(overrides = {}) {
  return {
    TELEGRAM_BOT_TOKEN: "123456:test-token",
    ALLOWED_TELEGRAM_USER_ID: "123456789",
    COMFYUI_BASE_URL: "http://127.0.0.1:8188",
    COMFYUI_WORKFLOW_PATH: "./workflow.json",
    COMFYUI_CHECKPOINT_NAME: "private-checkpoint.safetensors",
    COMFYUI_POSITIVE_PROMPT_NODE_ID: "10",
    COMFYUI_POSITIVE_PROMPT_INPUT: "text",
    COMFYUI_CHECKPOINT_NODE_ID: "1",
    COMFYUI_CHECKPOINT_INPUT: "ckpt_name",
    COMFYUI_SEED_NODE_ID: "20",
    COMFYUI_SEED_INPUT: "seed",
    COMFYUI_ADDITIONAL_SEED_MAPPINGS: "79:seed, 91:noise_seed",
    COMFYUI_SAVE_IMAGE_NODE_ID: "40",
    ...overrides,
  };
}

test("loadConfig validates and normalizes a complete environment", () => {
  const config = loadConfig(validEnvironment(), { cwd: process.cwd() });

  assert.deepEqual(config.telegram.allowedUserIds, ["123456789"]);
  assert.equal(config.comfyUi.baseUrl, "http://127.0.0.1:8188");
  assert.equal(config.comfyUi.checkpointName, "private-checkpoint.safetensors");
  assert.equal(config.comfyUi.pollIntervalMs, 2000);
  assert.equal(config.comfyUi.mappings.positivePromptNodeId, "10");
  assert.deepEqual(config.comfyUi.mappings.additionalSeedMappings, [
    { nodeId: "79", inputName: "seed" },
    { nodeId: "91", inputName: "noise_seed" },
  ]);
  assert.equal(config.activityLog.timeZone, "Asia/Tehran");
  assert.equal(config.seed.fixed, null);
  assert.equal(config.promptEnhancement.enabled, true);
  assert.equal(config.promptEnhancement.fallbackToRaw, false);
  assert.equal(config.prompt.maxLength, 3500);
  assert.equal(config.ollama.baseUrl, "http://127.0.0.1:11434");
  assert.match(config.ollama.model, /Gemma-The-Writer-9B/);
  assert.equal(config.ollama.numCtx, 8192);
  assert.equal(path.basename(config.activityLog.filePath), "activity-log.json");
  assert.equal(path.basename(config.userData.rootDirectory), "users");
  assert.equal(path.basename(config.userData.globalMemoryPath), "global-memory.json");
  assert.equal(config.generation.width, 896);
  assert.equal(config.generation.height, 1152);
  assert.equal(config.generation.clipSkip, null);
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
  assert.throws(
    () => loadConfig(validEnvironment({ COMFYUI_CHECKPOINT_NAME: "" })),
    (error) => error instanceof ConfigError && /COMFYUI_CHECKPOINT_NAME/.test(error.message),
  );
});

test("loadConfig rejects a non-loopback ComfyUI endpoint", () => {
  assert.throws(
    () => loadConfig(validEnvironment({ COMFYUI_BASE_URL: "https://example.com:8188" })),
    (error) => error instanceof ConfigError && /loopback/.test(error.message),
  );
});

test("loadConfig rejects a non-loopback Ollama endpoint", () => {
  assert.throws(
    () => loadConfig(validEnvironment({ OLLAMA_BASE_URL: "http://example.com:11434" })),
    (error) => error instanceof ConfigError && /OLLAMA_BASE_URL/.test(error.message),
  );
});

test("loadConfig validates prompt-enhancement booleans", () => {
  const enabled = loadConfig(
    validEnvironment({ PROMPT_ENHANCEMENT_FALLBACK_TO_RAW: "true" }),
  );
  assert.equal(enabled.promptEnhancement.fallbackToRaw, true);

  const unavailable = loadConfig(
    validEnvironment({ PROMPT_ENHANCEMENT_AVAILABLE: "false" }),
  );
  assert.equal(unavailable.promptEnhancement.enabled, false);

  assert.throws(
    () => loadConfig(validEnvironment({ OLLAMA_AUTO_START: "sometimes" })),
    (error) => error instanceof ConfigError && /true or false/.test(error.message),
  );
});

test("loadConfig supports multiple authorized Telegram accounts", () => {
  const config = loadConfig(
    validEnvironment({
      ALLOWED_TELEGRAM_USER_ID: "",
      ALLOWED_TELEGRAM_USER_IDS: "123456789,987654321",
    }),
  );

  assert.deepEqual(config.telegram.allowedUserIds, ["123456789", "987654321"]);
  assert.throws(
    () =>
      loadConfig(
        validEnvironment({
          ALLOWED_TELEGRAM_USER_ID: "",
          ALLOWED_TELEGRAM_USER_IDS: "123456789,123456789",
        }),
      ),
    (error) => error instanceof ConfigError && /duplicate/.test(error.message),
  );
});

test("loadConfig rejects invalid numeric limits", () => {
  assert.throws(
    () => loadConfig(validEnvironment({ GENERATION_QUEUE_MAX_SIZE: "unlimited" })),
    (error) => error instanceof ConfigError && /whole number/.test(error.message),
  );
});

test("loadConfig rejects malformed additional seed mappings", () => {
  assert.throws(
    () => loadConfig(validEnvironment({ COMFYUI_ADDITIONAL_SEED_MAPPINGS: "79" })),
    (error) => error instanceof ConfigError && /nodeId:inputName/.test(error.message),
  );
});

test("loadConfig accepts an optional fixed generation seed", () => {
  const config = loadConfig(validEnvironment({ GENERATION_SEED: "451905041881905" }));
  assert.equal(config.seed.fixed, 451905041881905);
});

test("loadConfig rejects an invalid fixed generation seed", () => {
  assert.throws(
    () => loadConfig(validEnvironment({ GENERATION_SEED: "-1" })),
    (error) => error instanceof ConfigError && /GENERATION_SEED/.test(error.message),
  );
});
