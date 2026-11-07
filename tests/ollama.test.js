import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { OllamaService } from "../src/services/ollama.service.js";
import { OllamaModelError, OllamaStartupError } from "../src/utils/errors.js";
import { silentLogger } from "./helpers.js";

function ollamaConfig(overrides = {}) {
  return {
    baseUrl: "http://127.0.0.1:11434",
    model: "local-gemma:q6",
    autoStart: true,
    executablePath: "ollama",
    startupTimeoutMs: 5000,
    requestTimeoutMs: 1000,
    unloadTimeoutMs: 5000,
    pollIntervalMs: 1,
    temperature: 0.35,
    topP: 0.9,
    numPredict: 700,
    numCtx: 4096,
    ...overrides,
  };
}

test("OllamaService reuses an already-running server", async () => {
  let spawnCalls = 0;
  const service = new OllamaService(ollamaConfig(), silentLogger, {
    httpClient: { get: async () => ({ data: { version: "1.0.0" } }) },
    spawnProcess: () => {
      spawnCalls += 1;
    },
  });

  const result = await service.ensureReady();
  assert.equal(result.started, false);
  assert.equal(spawnCalls, 0);
});

test("OllamaService starts one hidden background server when unavailable", async () => {
  let healthChecks = 0;
  let spawnCalls = 0;
  const child = new EventEmitter();
  child.pid = 1234;
  child.unref = () => undefined;
  const service = new OllamaService(ollamaConfig(), silentLogger, {
    httpClient: {
      async get(path) {
        assert.equal(path, "/api/version");
        healthChecks += 1;
        if (healthChecks < 3) {
          throw new Error("connection refused");
        }
        return { data: { version: "1.0.0" } };
      },
    },
    spawnProcess(executable, args, options) {
      spawnCalls += 1;
      assert.equal(executable, "ollama");
      assert.deepEqual(args, ["serve"]);
      assert.equal(options.windowsHide, true);
      assert.equal(options.detached, true);
      assert.equal(options.env.OLLAMA_HOST, "127.0.0.1:11434");
      return child;
    },
    sleep: async () => undefined,
  });

  const result = await service.ensureReady();
  assert.equal(result.started, true);
  assert.equal(spawnCalls, 1);
});

test("OllamaService fails with a bounded startup timeout", async () => {
  let time = 0;
  let killCalls = 0;
  const child = new EventEmitter();
  child.pid = 1234;
  child.unref = () => undefined;
  child.kill = () => {
    killCalls += 1;
  };
  const service = new OllamaService(
    ollamaConfig({ startupTimeoutMs: 1000 }),
    silentLogger,
    {
      httpClient: { get: async () => { throw new Error("connection refused"); } },
      spawnProcess: () => child,
      sleep: async () => undefined,
      now: () => {
        time += 500;
        return time;
      },
    },
  );

  await assert.rejects(() => service.ensureReady(), OllamaStartupError);
  assert.equal(killCalls, 1);
});

test("OllamaService sends the configured model, system prompt, and generation options", async () => {
  let submittedBody;
  const service = new OllamaService(ollamaConfig(), silentLogger, {
    httpClient: {
      async post(path, body) {
        assert.equal(path, "/api/chat");
        submittedBody = body;
        return {
          data: {
            message: { content: "A focused visual prompt" },
            total_duration: 100,
            load_duration: 20,
          },
        };
      },
    },
  });

  const result = await service.generateScenePrompt({
    userPrompt: "A long story",
    systemPrompt: "Direct one still image",
  });

  assert.equal(result.content, "A focused visual prompt");
  assert.equal(submittedBody.model, "local-gemma:q6");
  assert.equal(submittedBody.messages[0].role, "system");
  assert.equal(submittedBody.messages[0].content, "Direct one still image");
  assert.equal(submittedBody.messages[1].content, "A long story");
  assert.equal(submittedBody.keep_alive, 0);
  assert.deepEqual(submittedBody.options, {
    temperature: 0.35,
    top_p: 0.9,
    num_predict: 700,
    num_ctx: 4096,
  });
});

test("OllamaService reports a missing configured model without downloading it", async () => {
  const service = new OllamaService(ollamaConfig(), silentLogger, {
    httpClient: {
      get: async () => ({ data: { models: [{ name: "another-model:latest" }] } }),
    },
  });

  await assert.rejects(() => service.assertModelInstalled(), OllamaModelError);
});

test("OllamaService explicitly unloads the model and verifies it through api ps", async () => {
  const posts = [];
  let runningChecks = 0;
  const service = new OllamaService(ollamaConfig(), silentLogger, {
    httpClient: {
      async get(path) {
        if (path === "/api/version") {
          return { data: { version: "1.0.0" } };
        }
        assert.equal(path, "/api/ps");
        runningChecks += 1;
        return {
          data: {
            models: runningChecks === 1 ? [{ name: "local-gemma:q6" }] : [],
          },
        };
      },
      async post(path, body) {
        posts.push({ path, body });
        return { data: { done: true } };
      },
    },
    sleep: async () => undefined,
  });

  await service.unloadConfiguredModelAndWait();

  assert.deepEqual(posts, [
    {
      path: "/api/generate",
      body: { model: "local-gemma:q6", prompt: "", stream: false, keep_alive: 0 },
    },
  ]);
  assert.equal(runningChecks, 2);
});

test("OllamaService does not issue an unload request when this service never loaded the model", async () => {
  let postCalls = 0;
  const service = new OllamaService(ollamaConfig(), silentLogger, {
    httpClient: {
      async get(path) {
        if (path === "/api/version") {
          return { data: { version: "1.0.0" } };
        }
        assert.equal(path, "/api/ps");
        return { data: { models: [] } };
      },
      async post() {
        postCalls += 1;
      },
    },
  });

  const result = await service.unloadConfiguredModelAndWait();

  assert.equal(result.alreadyUnloaded, true);
  assert.equal(postCalls, 0);
});

test("OllamaService refuses to continue when post-inference unload cannot be verified", async () => {
  let available = true;
  const service = new OllamaService(ollamaConfig(), silentLogger, {
    httpClient: {
      async get(path) {
        if (path === "/api/version" && available) {
          return { data: { version: "1.0.0" } };
        }
        throw new Error("connection refused");
      },
      async post(path) {
        assert.equal(path, "/api/chat");
        available = false;
        return { data: { message: { content: "A focused visual prompt" } } };
      },
    },
  });

  await service.generateScenePrompt({ userPrompt: "story", systemPrompt: "system" });
  await assert.rejects(() => service.unloadConfiguredModelAndWait(), OllamaModelError);
});
