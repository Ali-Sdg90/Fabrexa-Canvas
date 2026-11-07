import { QueueFullError } from "../utils/errors.js";

export class GenerationQueue {
  #active = false;
  #closed = false;
  #pending = [];

  constructor({ maxSize, logger }) {
    this.maxSize = maxSize;
    this.logger = logger;
  }

  get size() {
    return Number(this.#active) + this.#pending.length;
  }

  get waitingCount() {
    return this.#pending.length;
  }

  add(task, metadata = {}) {
    if (typeof task !== "function") {
      throw new TypeError("Queue task must be a function.");
    }
    if (this.#closed) {
      throw new QueueFullError("The generation queue is shutting down.");
    }
    if (this.size >= this.maxSize) {
      throw new QueueFullError();
    }

    const jobsAhead = this.size;
    let resolveJob;
    let rejectJob;
    const promise = new Promise((resolve, reject) => {
      resolveJob = resolve;
      rejectJob = reject;
    });

    this.#pending.push({ task, metadata, resolve: resolveJob, reject: rejectJob });
    queueMicrotask(() => this.#drain());

    return Object.freeze({
      promise,
      queued: jobsAhead > 0,
      position: jobsAhead + 1,
    });
  }

  close() {
    this.#closed = true;
  }

  async #drain() {
    if (this.#active || this.#pending.length === 0) {
      return;
    }

    const job = this.#pending.shift();
    this.#active = true;
    this.logger.debug("Generation queue job started.", {
      queueSize: this.size,
      ...job.metadata,
    });

    try {
      job.resolve(await job.task());
    } catch (error) {
      job.reject(error);
    } finally {
      this.#active = false;
      this.logger.debug("Generation queue job finished.", {
        queueSize: this.size,
        ...job.metadata,
      });
      queueMicrotask(() => this.#drain());
    }
  }
}
