import assert from "node:assert/strict";
import test from "node:test";

import { GenerationQueue } from "../src/services/generation-queue.service.js";
import { QueueFullError } from "../src/utils/errors.js";
import { silentLogger } from "./helpers.js";

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test("GenerationQueue runs jobs one at a time in FIFO order", async () => {
  const queue = new GenerationQueue({ maxSize: 3, logger: silentLogger });
  const firstGate = deferred();
  const events = [];

  const first = queue.add(async () => {
    events.push("first:start");
    await firstGate.promise;
    events.push("first:end");
    return "first result";
  });
  const second = queue.add(async () => {
    events.push("second:start");
    events.push("second:end");
    return "second result";
  });

  assert.equal(first.queued, false);
  assert.equal(first.position, 1);
  assert.equal(second.queued, true);
  assert.equal(second.position, 2);

  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  assert.deepEqual(events, ["first:start"]);

  firstGate.resolve();
  assert.deepEqual(await Promise.all([first.promise, second.promise]), [
    "first result",
    "second result",
  ]);
  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
  assert.equal(queue.size, 0);
});

test("GenerationQueue enforces its active-plus-waiting size limit", () => {
  const queue = new GenerationQueue({ maxSize: 2, logger: silentLogger });
  const never = deferred();
  queue.add(() => never.promise);
  queue.add(() => never.promise);

  assert.throws(() => queue.add(async () => undefined), QueueFullError);
});
