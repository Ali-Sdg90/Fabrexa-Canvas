import path from "node:path";

import { ConfigError } from "../utils/errors.js";
import { GENERATION_SETTINGS } from "./generation.config.js";

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);
const LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);

function requireString(environment, name) {
  const value = environment[name]?.trim();
  if (!value) {
    throw new ConfigError(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalString(environment, name, fallback) {
  return environment[name]?.trim() || fallback;
}

function parseInteger(environment, name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const rawValue = optionalString(environment, name, String(fallback));
  if (!/^\d+$/.test(rawValue)) {
    throw new ConfigError(`${name} must be a whole number.`);
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be between ${min} and ${max}.`);
  }
  return value;
}

function parseOptionalSeed(environment) {
  const rawValue = environment.GENERATION_SEED?.trim();
  if (!rawValue) {
    return null;
  }
  if (!/^\d+$/.test(rawValue)) {
    throw new ConfigError("GENERATION_SEED must be a non-negative whole number or left blank.");
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ConfigError(
      `GENERATION_SEED must be between 0 and ${Number.MAX_SAFE_INTEGER}, or left blank.`,
    );
  }
  return value;
}

function parseTelegramUserId(environment) {
  const value = requireString(environment, "ALLOWED_TELEGRAM_USER_ID");
  if (!/^\d+$/.test(value) || value === "0") {
    throw new ConfigError("ALLOWED_TELEGRAM_USER_ID must be a positive numeric Telegram user ID.");
  }
  return value;
}

function parseComfyUiUrl(environment) {
  const rawValue = optionalString(environment, "COMFYUI_BASE_URL", "http://127.0.0.1:8188");
  let url;
  try {
    url = new URL(rawValue);
  } catch {
    throw new ConfigError("COMFYUI_BASE_URL must be a valid URL.");
  }

  if (url.protocol !== "http:" || !LOOPBACK_HOSTNAMES.has(url.hostname)) {
    throw new ConfigError(
      "COMFYUI_BASE_URL must use HTTP and a loopback host: 127.0.0.1, localhost, or ::1.",
    );
  }
  if (url.username || url.password || (url.pathname !== "/" && url.pathname !== "")) {
    throw new ConfigError("COMFYUI_BASE_URL must not contain credentials or a path.");
  }

  return url.toString().replace(/\/$/, "");
}

function parseLogLevel(environment) {
  const level = optionalString(environment, "LOG_LEVEL", "info").toLowerCase();
  if (!LOG_LEVELS.has(level)) {
    throw new ConfigError("LOG_LEVEL must be debug, info, warn, or error.");
  }
  return level;
}

function parseAdditionalSeedMappings(environment) {
  const rawValue = environment.COMFYUI_ADDITIONAL_SEED_MAPPINGS?.trim();
  if (!rawValue) {
    return Object.freeze([]);
  }

  const mappings = rawValue.split(",").map((mapping) => {
    const [nodeId, inputName, ...extraParts] = mapping.split(":").map((part) => part.trim());
    if (!nodeId || !inputName || extraParts.length > 0) {
      throw new ConfigError(
        "COMFYUI_ADDITIONAL_SEED_MAPPINGS must use comma-separated nodeId:inputName pairs.",
      );
    }
    return Object.freeze({ nodeId, inputName });
  });

  const uniqueMappings = new Set(mappings.map(({ nodeId, inputName }) => `${nodeId}:${inputName}`));
  if (uniqueMappings.size !== mappings.length) {
    throw new ConfigError("COMFYUI_ADDITIONAL_SEED_MAPPINGS contains a duplicate mapping.");
  }

  return Object.freeze(mappings);
}

function parseTimeZone(environment) {
  const timeZone = optionalString(environment, "ACTIVITY_LOG_TIME_ZONE", "Asia/Tehran");
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format();
  } catch {
    throw new ConfigError("ACTIVITY_LOG_TIME_ZONE must be a valid IANA time zone.");
  }
  return timeZone;
}

export function loadConfig(environment = process.env, { cwd = process.cwd() } = {}) {
  const workflowPathValue = optionalString(
    environment,
    "COMFYUI_WORKFLOW_PATH",
    "./src/workflows/workflow_api.json",
  );
  const activityLogPathValue = optionalString(
    environment,
    "ACTIVITY_LOG_PATH",
    "./data/activity-log.json",
  );

  return Object.freeze({
    telegram: Object.freeze({
      botToken: requireString(environment, "TELEGRAM_BOT_TOKEN"),
      allowedUserId: parseTelegramUserId(environment),
      actionIntervalMs: parseInteger(environment, "TELEGRAM_ACTION_INTERVAL_MS", 4000, {
        min: 1000,
        max: 15000,
      }),
    }),
    comfyUi: Object.freeze({
      baseUrl: parseComfyUiUrl(environment),
      workflowPath: path.resolve(cwd, workflowPathValue),
      pollIntervalMs: parseInteger(environment, "COMFYUI_POLL_INTERVAL_MS", 2000, {
        min: 250,
        max: 60000,
      }),
      timeoutMs: parseInteger(environment, "COMFYUI_TIMEOUT_MS", 240000, {
        min: 1000,
        max: 3600000,
      }),
      requestTimeoutMs: parseInteger(environment, "COMFYUI_REQUEST_TIMEOUT_MS", 10000, {
        min: 500,
        max: 120000,
      }),
      mappings: Object.freeze({
        positivePromptNodeId: requireString(environment, "COMFYUI_POSITIVE_PROMPT_NODE_ID"),
        positivePromptInput: requireString(environment, "COMFYUI_POSITIVE_PROMPT_INPUT"),
        seedNodeId: requireString(environment, "COMFYUI_SEED_NODE_ID"),
        seedInput: requireString(environment, "COMFYUI_SEED_INPUT"),
        additionalSeedMappings: parseAdditionalSeedMappings(environment),
        saveImageNodeId: requireString(environment, "COMFYUI_SAVE_IMAGE_NODE_ID"),
      }),
    }),
    queue: Object.freeze({
      maxSize: parseInteger(environment, "GENERATION_QUEUE_MAX_SIZE", 5, { min: 1, max: 25 }),
    }),
    seed: Object.freeze({
      fixed: parseOptionalSeed(environment),
    }),
    prompt: Object.freeze({
      maxLength: parseInteger(environment, "PROMPT_MAX_LENGTH", 1500, { min: 1, max: 3500 }),
    }),
    updates: Object.freeze({
      dedupTtlMs: parseInteger(environment, "UPDATE_DEDUP_TTL_MS", 600000, {
        min: 1000,
        max: 86400000,
      }),
      dedupMaxSize: parseInteger(environment, "UPDATE_DEDUP_MAX_SIZE", 1000, {
        min: 10,
        max: 10000,
      }),
    }),
    activityLog: Object.freeze({
      filePath: path.resolve(cwd, activityLogPathValue),
      timeZone: parseTimeZone(environment),
    }),
    logging: Object.freeze({ level: parseLogLevel(environment) }),
    generation: GENERATION_SETTINGS,
  });
}
