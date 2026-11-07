import { GpuHandoffError } from "../utils/errors.js";

function sleepFor(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export class GpuHandoffService {
  constructor(
    { comfyUiService, ollamaService, pollIntervalMs, logger },
    { sleep = sleepFor } = {},
  ) {
    this.comfyUiService = comfyUiService;
    this.ollamaService = ollamaService;
    this.pollIntervalMs = pollIntervalMs;
    this.logger = logger;
    this.sleep = sleep;
  }

  async prepareForLanguageModel() {
    const result = await this.comfyUiService.releaseModelsForExternalInference();
    this.logger.info("ComfyUI models released before local language-model inference.", result);
    return result;
  }

  async runLanguageModelStage(inferenceTask) {
    const abortController = new AbortController();
    let monitoring = true;

    const monitoredInference = (async () => {
      let inferenceResult;
      let inferenceError;
      try {
        inferenceResult = await inferenceTask(abortController.signal);
      } catch (error) {
        inferenceError = error;
      }

      let unloadResult;
      try {
        unloadResult = await this.ollamaService.unloadConfiguredModelAndWait();
      } catch (unloadError) {
        throw new GpuHandoffError(
          "The Ollama model could not be verified as unloaded; ComfyUI generation was not started.",
          { cause: unloadError },
        );
      }

      if (inferenceError) {
        throw inferenceError;
      }
      return { inferenceResult, unloadResult };
    })();

    const idleMonitor = (async () => {
      try {
        while (monitoring) {
          const queue = await this.comfyUiService.getQueueState();
          if (!queue.idle) {
            throw new GpuHandoffError(
              "ComfyUI started another job during local language-model inference.",
            );
          }
          await this.sleep(this.pollIntervalMs);
        }
        return null;
      } catch (error) {
        abortController.abort(error);
        throw error;
      }
    })();

    try {
      return await Promise.race([monitoredInference, idleMonitor]);
    } finally {
      monitoring = false;
      await Promise.allSettled([monitoredInference, idleMonitor]);
    }
  }

  async prepareForImageGeneration() {
    const result = await this.comfyUiService.waitUntilIdle();
    this.logger.info("GPU handoff to ComfyUI completed.", result);
    return result;
  }
}
