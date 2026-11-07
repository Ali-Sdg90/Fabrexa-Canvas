import { spawn } from "node:child_process";

import axios from "axios";

import { OllamaError, OllamaModelError, OllamaStartupError } from "../utils/errors.js";

function sleepFor(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function normalizedModelName(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function modelMatches(candidate, configuredModel) {
  const candidateName = normalizedModelName(candidate);
  const expectedName = normalizedModelName(configuredModel);
  return candidateName === expectedName || candidateName === `${expectedName}:latest`;
}

function normalizeOllamaHttpError(error, action) {
  if (error instanceof OllamaError) {
    return error;
  }
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const serverMessage = error.response?.data?.error;
    return new OllamaError(
      status
        ? `Ollama ${action} request failed with HTTP ${status}.`
        : `Could not reach Ollama while trying to ${action}.`,
      {
        cause: error,
        details: {
          status,
          serverMessage: typeof serverMessage === "string" ? serverMessage : undefined,
        },
      },
    );
  }
  return new OllamaError(`Unexpected Ollama error while trying to ${action}.`, { cause: error });
}

export class OllamaService {
  #startPromise = null;
  #modelMayBeLoaded = false;

  constructor(
    config,
    logger,
    {
      httpClient,
      spawnProcess = spawn,
      sleep = sleepFor,
      now = Date.now,
    } = {},
  ) {
    this.config = config;
    this.logger = logger;
    this.spawnProcess = spawnProcess;
    this.sleep = sleep;
    this.now = now;
    this.httpClient =
      httpClient ??
      axios.create({
        baseURL: config.baseUrl,
        timeout: config.requestTimeoutMs,
        maxRedirects: 0,
      });
  }

  async isAvailable() {
    try {
      const response = await this.httpClient.get("/api/version");
      return typeof response?.data?.version === "string";
    } catch {
      return false;
    }
  }

  async ensureReady() {
    const startedAt = this.now();
    if (await this.isAvailable()) {
      return { started: false, durationMs: this.now() - startedAt };
    }
    if (!this.config.autoStart) {
      throw new OllamaStartupError(
        "Ollama is unavailable and automatic startup is disabled.",
      );
    }

    if (!this.#startPromise) {
      this.#startPromise = this.#startAndWait().finally(() => {
        this.#startPromise = null;
      });
    }
    const result = await this.#startPromise;
    return { ...result, durationMs: this.now() - startedAt };
  }

  async #startAndWait() {
    let startError = null;
    let exitCode = null;
    let childProcess;

    try {
      childProcess = this.spawnProcess(this.config.executablePath, ["serve"], {
        detached: true,
        env: {
          ...process.env,
          OLLAMA_HOST: new URL(this.config.baseUrl).host,
        },
        stdio: "ignore",
        windowsHide: true,
      });
    } catch (error) {
      throw new OllamaStartupError(
        `Could not start Ollama using "${this.config.executablePath} serve".`,
        { cause: error },
      );
    }

    childProcess.once?.("error", (error) => {
      startError = error;
    });
    childProcess.once?.("exit", (code) => {
      exitCode = code;
    });
    childProcess.unref?.();
    this.logger.info("Started a background Ollama server process.", {
      executablePath: this.config.executablePath,
      processId: childProcess.pid,
    });

    const deadline = this.now() + this.config.startupTimeoutMs;
    while (this.now() < deadline) {
      if (await this.isAvailable()) {
        return { started: true, processId: childProcess.pid };
      }
      if (startError) {
        throw new OllamaStartupError("The Ollama server process could not start.", {
          cause: startError,
        });
      }
      if (exitCode !== null) {
        throw new OllamaStartupError(
          `The Ollama server process exited before becoming ready with code ${exitCode}.`,
        );
      }
      await this.sleep(this.config.pollIntervalMs);
    }

    try {
      childProcess.kill?.();
    } catch (error) {
      this.logger.warn("Could not stop the Ollama process after startup timed out.", {
        error,
        processId: childProcess.pid,
      });
    }
    throw new OllamaStartupError(
      `Ollama did not become ready within ${this.config.startupTimeoutMs} ms.`,
    );
  }

  async assertModelInstalled() {
    try {
      const response = await this.httpClient.get("/api/tags");
      const models = Array.isArray(response?.data?.models) ? response.data.models : [];
      const installed = models.some(
        (model) =>
          modelMatches(model?.name, this.config.model) ||
          modelMatches(model?.model, this.config.model),
      );
      if (!installed) {
        throw new OllamaModelError(
          `The configured Ollama model is not installed: ${this.config.model}`,
        );
      }
      return true;
    } catch (error) {
      if (error instanceof OllamaModelError) {
        throw error;
      }
      throw normalizeOllamaHttpError(error, "list installed models");
    }
  }

  async generateScenePrompt({ userPrompt, systemPrompt, signal }) {
    try {
      // Once inference is requested, require a verified unload before ComfyUI may run.
      // This is deliberately conservative when a request fails mid-flight.
      this.#modelMayBeLoaded = true;
      const response = await this.httpClient.post(
        "/api/chat",
        {
          model: this.config.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          stream: false,
          keep_alive: 0,
          options: {
            temperature: this.config.temperature,
            top_p: this.config.topP,
            num_predict: this.config.numPredict,
            num_ctx: this.config.numCtx,
          },
        },
        { signal },
      );

      const content = response?.data?.message?.content;
      if (typeof content !== "string") {
        throw new OllamaModelError("Ollama returned a malformed chat response.");
      }
      return {
        content,
        metrics: {
          totalDurationNs: response.data.total_duration,
          loadDurationNs: response.data.load_duration,
          promptEvalCount: response.data.prompt_eval_count,
          evalCount: response.data.eval_count,
        },
      };
    } catch (error) {
      if (error instanceof OllamaModelError) {
        throw error;
      }
      throw normalizeOllamaHttpError(error, "generate the scene prompt");
    }
  }

  async getRunningModels() {
    try {
      const response = await this.httpClient.get("/api/ps");
      return Array.isArray(response?.data?.models) ? response.data.models : [];
    } catch (error) {
      throw normalizeOllamaHttpError(error, "inspect running models");
    }
  }

  async unloadConfiguredModelAndWait() {
    if (!(await this.isAvailable())) {
      if (this.#modelMayBeLoaded) {
        throw new OllamaModelError(
          "Ollama became unavailable before the configured model could be verified as unloaded.",
        );
      }
      return { serverAvailable: false, durationMs: 0 };
    }

    const startedAt = this.now();
    const initiallyRunningModels = await this.getRunningModels();
    const initiallyLoaded = initiallyRunningModels.some(
      (model) =>
        modelMatches(model?.name, this.config.model) ||
        modelMatches(model?.model, this.config.model),
    );
    if (!this.#modelMayBeLoaded && !initiallyLoaded) {
      return { serverAvailable: true, alreadyUnloaded: true, durationMs: this.now() - startedAt };
    }

    try {
      await this.httpClient.post("/api/generate", {
        model: this.config.model,
        prompt: "",
        stream: false,
        keep_alive: 0,
      });
    } catch (error) {
      throw normalizeOllamaHttpError(error, "request model unloading");
    }

    const deadline = startedAt + this.config.unloadTimeoutMs;
    while (this.now() < deadline) {
      const runningModels = await this.getRunningModels();
      const stillLoaded = runningModels.some(
        (model) =>
          modelMatches(model?.name, this.config.model) ||
          modelMatches(model?.model, this.config.model),
      );
      if (!stillLoaded) {
        this.#modelMayBeLoaded = false;
        return { serverAvailable: true, durationMs: this.now() - startedAt };
      }
      await this.sleep(this.config.pollIntervalMs);
    }

    throw new OllamaModelError(
      `The configured Ollama model remained loaded after ${this.config.unloadTimeoutMs} ms.`,
    );
  }
}
