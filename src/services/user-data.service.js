import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { UserDataError } from "../utils/errors.js";

const USER_ID_PATTERN = /^\d+$/;
const CHAT_ROLES = new Set(["user", "assistant", "system"]);

function formatLocalTimestamp(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .reduce((values, part) => {
      if (part.type !== "literal") {
        values[part.type] = part.value;
      }
      return values;
    }, {});

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function normalizeUser(user) {
  const id = String(user?.id ?? "");
  if (!USER_ID_PATTERN.test(id) || id === "0") {
    throw new UserDataError("A positive numeric Telegram user ID is required for user data.");
  }

  return Object.freeze({
    id,
    username: user?.username ?? null,
    firstName: user?.firstName ?? null,
    lastName: user?.lastName ?? null,
  });
}

function defaultPreferences(user) {
  return {
    version: 1,
    telegramUser: user,
    gemmaEnabled: null,
    updatedAt: null,
  };
}

function validatePreferences(value, filePath) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value.gemmaEnabled !== null && typeof value.gemmaEnabled !== "boolean")
  ) {
    throw new UserDataError(
      `Could not load user preferences at "${filePath}". The file has an invalid structure.`,
    );
  }
  return value;
}

function validateChatHistory(value, filePath) {
  if (!Array.isArray(value)) {
    throw new UserDataError(
      `Could not load chat history at "${filePath}". The file must contain a JSON array.`,
    );
  }
  return value;
}

async function readJson(filePath, validate, fallback) {
  try {
    return validate(JSON.parse(await readFile(filePath, "utf8")), filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    if (error instanceof UserDataError) {
      throw error;
    }
    throw new UserDataError(`Could not read valid JSON from "${filePath}".`, { cause: error });
  }
}

async function writeJsonAtomically(filePath, value) {
  const temporaryPath = `${filePath}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export class UserDataService {
  #globalEntries = [];
  #users = new Map();
  #writeQueue = Promise.resolve();

  constructor({
    rootDirectory,
    globalMemoryPath,
    timeZone,
    logger,
    now = () => new Date(),
    createId = randomUUID,
  }) {
    this.rootDirectory = rootDirectory;
    this.globalMemoryPath = globalMemoryPath;
    this.timeZone = timeZone;
    this.logger = logger;
    this.now = now;
    this.createId = createId;
  }

  async initialize() {
    await mkdir(this.rootDirectory, { recursive: true });
    await mkdir(path.dirname(this.globalMemoryPath), { recursive: true });
    this.#globalEntries = await readJson(
      this.globalMemoryPath,
      validateChatHistory,
      [],
    );
    if (this.#globalEntries.length === 0) {
      await writeJsonAtomically(this.globalMemoryPath, this.#globalEntries);
    }

    this.logger.info("Per-user data and global memory initialized.", {
      rootDirectory: this.rootDirectory,
      globalMemoryPath: this.globalMemoryPath,
      globalEntryCount: this.#globalEntries.length,
      timeZone: this.timeZone,
    });
  }

  getGemmaPreference(user) {
    return this.#enqueue(async () => {
      const record = await this.#loadUser(user);
      return record.preferences.gemmaEnabled;
    });
  }

  setGemmaPreference(user, gemmaEnabled) {
    if (typeof gemmaEnabled !== "boolean") {
      return Promise.reject(new TypeError("gemmaEnabled must be a boolean."));
    }

    return this.#enqueue(async () => {
      const normalizedUser = normalizeUser(user);
      const record = await this.#loadUser(normalizedUser);
      const updatedAt = this.now().toISOString();
      const nextPreferences = {
        version: 1,
        telegramUser: normalizedUser,
        gemmaEnabled,
        updatedAt,
      };

      try {
        await writeJsonAtomically(record.preferencesPath, nextPreferences);
      } catch (error) {
        throw new UserDataError("Could not save the user's Gemma preference.", {
          cause: error,
          details: { userId: normalizedUser.id },
        });
      }
      record.preferences = nextPreferences;
      return Object.freeze({ gemmaEnabled, updatedAt });
    });
  }

  appendChat({ user, role, type, text, telegramUpdateId = null, chatId = null, metadata = {} }) {
    return this.#enqueue(async () => {
      if (!CHAT_ROLES.has(role)) {
        throw new TypeError(`Unsupported chat role: ${role}`);
      }
      if (typeof type !== "string" || !type.trim()) {
        throw new TypeError("Chat entry type must be a non-empty string.");
      }
      if (typeof text !== "string") {
        throw new TypeError("Chat entry text must be a string.");
      }

      const normalizedUser = normalizeUser(user);
      const record = await this.#loadUser(normalizedUser);
      const occurredAt = this.now();
      const entry = {
        id: this.createId(),
        timestamp: occurredAt.toISOString(),
        localTimestamp: formatLocalTimestamp(occurredAt, this.timeZone),
        timeZone: this.timeZone,
        telegramUpdateId,
        chatId,
        user: normalizedUser,
        role,
        type: type.trim(),
        text,
        metadata,
      };

      record.chatHistory.push(entry);
      try {
        await writeJsonAtomically(record.chatHistoryPath, record.chatHistory);
      } catch (error) {
        record.chatHistory.pop();
        throw new UserDataError("Could not append to the user's chat history.", {
          cause: error,
          details: { userId: normalizedUser.id },
        });
      }

      this.#globalEntries.push(entry);
      try {
        await writeJsonAtomically(this.globalMemoryPath, this.#globalEntries);
      } catch (error) {
        this.#globalEntries.pop();
        record.chatHistory.pop();
        await writeJsonAtomically(record.chatHistoryPath, record.chatHistory).catch(
          () => undefined,
        );
        throw new UserDataError("Could not append to the global conversation memory.", {
          cause: error,
          details: { userId: normalizedUser.id },
        });
      }

      return Object.freeze(entry);
    });
  }

  #enqueue(operation) {
    const queuedOperation = this.#writeQueue.then(operation);
    this.#writeQueue = queuedOperation.catch(() => undefined);
    return queuedOperation;
  }

  async #loadUser(user) {
    const normalizedUser = normalizeUser(user);
    const cached = this.#users.get(normalizedUser.id);
    if (cached) {
      return cached;
    }

    const userDirectory = path.join(this.rootDirectory, normalizedUser.id);
    const preferencesPath = path.join(userDirectory, "preferences.json");
    const chatHistoryPath = path.join(userDirectory, "chats.json");
    await mkdir(userDirectory, { recursive: true });

    const preferences = await readJson(
      preferencesPath,
      validatePreferences,
      defaultPreferences(normalizedUser),
    );
    const chatHistory = await readJson(chatHistoryPath, validateChatHistory, []);
    const record = { preferencesPath, chatHistoryPath, preferences, chatHistory };

    try {
      await Promise.all([
        writeJsonAtomically(preferencesPath, preferences),
        writeJsonAtomically(chatHistoryPath, chatHistory),
      ]);
    } catch (error) {
      throw new UserDataError("Could not initialize the user's data directory.", {
        cause: error,
        details: { userId: normalizedUser.id, userDirectory },
      });
    }

    this.#users.set(normalizedUser.id, record);
    return record;
  }
}
