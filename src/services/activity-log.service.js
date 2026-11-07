import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { ActivityLogError } from "../utils/errors.js";

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

export class ActivityLogService {
  #entries = [];
  #writeQueue = Promise.resolve();

  constructor({ filePath, timeZone, logger, now = () => new Date() }) {
    this.filePath = filePath;
    this.timeZone = timeZone;
    this.logger = logger;
    this.now = now;
  }

  async initialize() {
    await mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const existingContent = await readFile(this.filePath, "utf8");
      const parsedContent = JSON.parse(existingContent);
      if (!Array.isArray(parsedContent)) {
        throw new TypeError("The root value must be a JSON array.");
      }
      this.#entries = parsedContent;
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw new ActivityLogError(
          `Could not load the activity log at "${this.filePath}". The file must contain a valid JSON array.`,
          { cause: error },
        );
      }
      await this.#writeEntries();
    }

    this.logger.info("Activity log initialized.", {
      filePath: this.filePath,
      entryCount: this.#entries.length,
      timeZone: this.timeZone,
    });
  }

  append(event) {
    const writeOperation = this.#writeQueue.then(() => this.#appendEvent(event));
    this.#writeQueue = writeOperation.catch(() => undefined);
    return writeOperation;
  }

  async #appendEvent(event) {
    const occurredAt = this.now();
    const entry = {
      ...event,
      event: event.event,
      timestamp: occurredAt.toISOString(),
      localTimestamp: formatLocalTimestamp(occurredAt, this.timeZone),
      timeZone: this.timeZone,
    };

    this.#entries.push(entry);
    try {
      await this.#writeEntries();
    } catch (error) {
      this.#entries.pop();
      throw new ActivityLogError("Could not write the activity log.", {
        cause: error,
        details: { filePath: this.filePath, event: event.event },
      });
    }
    return entry;
  }

  async #writeEntries() {
    const temporaryPath = `${this.filePath}.tmp-${randomUUID()}`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(this.#entries, null, 2)}\n`, "utf8");
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }
}
