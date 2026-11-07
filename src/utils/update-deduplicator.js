export class UpdateDeduplicator {
  #entries = new Map();

  constructor({ ttlMs, maxSize, now = Date.now }) {
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
    this.now = now;
  }

  isDuplicate(updateId) {
    if (!Number.isInteger(updateId)) {
      return false;
    }

    const currentTime = this.now();
    this.#prune(currentTime);
    if (this.#entries.has(updateId)) {
      return true;
    }

    this.#entries.set(updateId, currentTime);
    while (this.#entries.size > this.maxSize) {
      this.#entries.delete(this.#entries.keys().next().value);
    }
    return false;
  }

  #prune(currentTime) {
    for (const [updateId, timestamp] of this.#entries) {
      if (currentTime - timestamp <= this.ttlMs) {
        break;
      }
      this.#entries.delete(updateId);
    }
  }
}
