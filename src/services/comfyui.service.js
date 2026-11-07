import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import axios from "axios";

import {
  ComfyUiError,
  GenerationFailedError,
  GenerationTimeoutError,
  GpuHandoffError,
  WorkflowError,
} from "../utils/errors.js";

const ALLOWED_IMAGE_TYPES = new Set(["output", "temp"]);

function assertWorkflowObject(workflow) {
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
    throw new WorkflowError("The API workflow must be a JSON object keyed by node IDs.");
  }
}

function getMappedNode(workflow, nodeId, label) {
  const node = workflow[nodeId];
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    throw new WorkflowError(`${label} node "${nodeId}" was not found in the API workflow.`);
  }
  if (!node.inputs || typeof node.inputs !== "object" || Array.isArray(node.inputs)) {
    throw new WorkflowError(`${label} node "${nodeId}" has no inputs object.`);
  }
  return node;
}

function assertMappedInput(node, nodeId, inputName, label) {
  if (!Object.hasOwn(node.inputs, inputName)) {
    throw new WorkflowError(
      `${label} input "${inputName}" was not found on workflow node "${nodeId}".`,
    );
  }
}

export function validateWorkflowMappings(workflow, mappings) {
  assertWorkflowObject(workflow);

  const positiveNode = getMappedNode(workflow, mappings.positivePromptNodeId, "Positive prompt");
  assertMappedInput(
    positiveNode,
    mappings.positivePromptNodeId,
    mappings.positivePromptInput,
    "Positive prompt",
  );

  const checkpointNode = getMappedNode(workflow, mappings.checkpointNodeId, "Checkpoint");
  assertMappedInput(
    checkpointNode,
    mappings.checkpointNodeId,
    mappings.checkpointInput,
    "Checkpoint",
  );
  if (checkpointNode.class_type !== "CheckpointLoaderSimple") {
    throw new WorkflowError(
      `Mapped checkpoint node "${mappings.checkpointNodeId}" must have class_type "CheckpointLoaderSimple".`,
    );
  }

  const seedNode = getMappedNode(workflow, mappings.seedNodeId, "Seed");
  assertMappedInput(seedNode, mappings.seedNodeId, mappings.seedInput, "Seed");

  for (const { nodeId, inputName } of mappings.additionalSeedMappings ?? []) {
    const additionalSeedNode = getMappedNode(workflow, nodeId, "Additional seed");
    assertMappedInput(additionalSeedNode, nodeId, inputName, "Additional seed");
  }

  const saveImageNode = getMappedNode(workflow, mappings.saveImageNodeId, "SaveImage");
  if (saveImageNode.class_type !== "SaveImage") {
    throw new WorkflowError(
      `Mapped output node "${mappings.saveImageNodeId}" must have class_type "SaveImage".`,
    );
  }

  return true;
}

export function cloneAndInjectWorkflow(workflow, mappings, { prompt, seed, checkpointName }) {
  validateWorkflowMappings(workflow, mappings);
  const clonedWorkflow = structuredClone(workflow);
  clonedWorkflow[mappings.positivePromptNodeId].inputs[mappings.positivePromptInput] = prompt;
  clonedWorkflow[mappings.checkpointNodeId].inputs[mappings.checkpointInput] = checkpointName;
  clonedWorkflow[mappings.seedNodeId].inputs[mappings.seedInput] = seed;
  for (const { nodeId, inputName } of mappings.additionalSeedMappings ?? []) {
    clonedWorkflow[nodeId].inputs[inputName] = seed;
  }
  return clonedWorkflow;
}

function executionFailureFromHistory(historyEntry) {
  const messages = historyEntry?.status?.messages;
  if (!Array.isArray(messages)) {
    return null;
  }

  const failure = messages.find(
    (message) =>
      Array.isArray(message) &&
      ["execution_error", "execution_interrupted"].includes(message[0]),
  );
  if (!failure) {
    return null;
  }

  const details = failure[1];
  return typeof details?.exception_message === "string"
    ? details.exception_message
    : "ComfyUI reported an execution failure.";
}

function assertSafeImageMetadata(image) {
  if (!image || typeof image !== "object") {
    throw new ComfyUiError("ComfyUI returned invalid image metadata.");
  }

  const { filename, subfolder = "", type = "output" } = image;
  if (
    typeof filename !== "string" ||
    !filename ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename.includes("\0") ||
    filename === "." ||
    filename === ".."
  ) {
    throw new ComfyUiError("ComfyUI returned an unsafe image filename.");
  }
  if (
    typeof subfolder !== "string" ||
    subfolder.includes("\0") ||
    subfolder.split(/[\\/]+/).some((part) => part === "..")
  ) {
    throw new ComfyUiError("ComfyUI returned an unsafe image subfolder.");
  }
  if (!ALLOWED_IMAGE_TYPES.has(type)) {
    throw new ComfyUiError(`ComfyUI returned an unsupported image type: ${type}`);
  }

  return { filename, subfolder, type };
}

export function extractOutputImage(historyEntry, saveImageNodeId) {
  const images = historyEntry?.outputs?.[saveImageNodeId]?.images;
  if (!Array.isArray(images) || images.length === 0) {
    throw new ComfyUiError(
      `No output image was found for SaveImage node "${saveImageNodeId}".`,
    );
  }
  return assertSafeImageMetadata(images.at(-1));
}

function normalizeHttpError(error, action) {
  if (error instanceof ComfyUiError || error instanceof GenerationFailedError) {
    return error;
  }
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const responseError = error.response?.data?.error;
    return new ComfyUiError(
      status
        ? `ComfyUI ${action} request failed with HTTP ${status}.`
        : `Could not reach ComfyUI while trying to ${action}.`,
      {
        cause: error,
        details: {
          status,
          serverErrorType: responseError?.type,
          serverErrorMessage: responseError?.message,
        },
      },
    );
  }
  return new ComfyUiError(`Unexpected ComfyUI error while trying to ${action}.`, { cause: error });
}

export class ComfyUIService {
  constructor(
    config,
    logger,
    {
      httpClient,
      readWorkflowFile = readFile,
      sleep = (milliseconds) =>
        new Promise((resolve) => {
          setTimeout(resolve, milliseconds);
        }),
      now = Date.now,
      clientId = randomUUID(),
    } = {},
  ) {
    this.config = config;
    this.logger = logger;
    this.httpClient =
      httpClient ??
      axios.create({
        baseURL: config.baseUrl,
        timeout: config.requestTimeoutMs,
        maxRedirects: 0,
      });
    this.readWorkflowFile = readWorkflowFile;
    this.sleep = sleep;
    this.now = now;
    this.clientId = clientId;
    this.baseWorkflow = null;
  }

  async initialize() {
    let rawWorkflow;
    try {
      rawWorkflow = await this.readWorkflowFile(this.config.workflowPath, "utf8");
    } catch (error) {
      throw new WorkflowError(
        `Could not read the API workflow at "${this.config.workflowPath}". Export the working ComfyUI workflow in API format and place it there.`,
        { cause: error },
      );
    }

    try {
      this.baseWorkflow = JSON.parse(rawWorkflow);
    } catch (error) {
      throw new WorkflowError(`The workflow at "${this.config.workflowPath}" is not valid JSON.`, {
        cause: error,
      });
    }
    validateWorkflowMappings(this.baseWorkflow, this.config.mappings);
    this.logger.info("ComfyUI API workflow loaded and validated.", {
      workflowPath: this.config.workflowPath,
      nodeCount: Object.keys(this.baseWorkflow).length,
    });
  }

  createWorkflow(prompt, seed) {
    if (!this.baseWorkflow) {
      throw new WorkflowError("ComfyUI service must be initialized before creating a workflow.");
    }
    return cloneAndInjectWorkflow(this.baseWorkflow, this.config.mappings, {
      prompt,
      seed,
      checkpointName: this.config.checkpointName,
    });
  }

  async submitWorkflow(workflow) {
    try {
      const response = await this.httpClient.post("/prompt", {
        prompt: workflow,
        client_id: this.clientId,
      });
      const promptId = response?.data?.prompt_id;
      if (typeof promptId !== "string" || !promptId) {
        const nodeErrors = response?.data?.node_errors;
        throw new ComfyUiError("ComfyUI did not return a valid prompt_id.", {
          details: { nodeErrors },
        });
      }
      return promptId;
    } catch (error) {
      throw normalizeHttpError(error, "submit the workflow");
    }
  }

  async getQueueState() {
    try {
      const response = await this.httpClient.get("/queue");
      const running = response?.data?.queue_running;
      const pending = response?.data?.queue_pending;
      if (!Array.isArray(running) || !Array.isArray(pending)) {
        throw new ComfyUiError("ComfyUI returned an invalid queue response.");
      }
      return { running, pending, idle: running.length === 0 && pending.length === 0 };
    } catch (error) {
      throw normalizeHttpError(error, "inspect the queue");
    }
  }

  async waitUntilIdle() {
    const startedAt = this.now();
    while (this.now() - startedAt < this.config.idleTimeoutMs) {
      const queue = await this.getQueueState();
      if (queue.idle) {
        return { durationMs: this.now() - startedAt };
      }
      await this.sleep(this.config.cleanupPollIntervalMs);
    }
    throw new GpuHandoffError(
      `ComfyUI remained busy for more than ${this.config.idleTimeoutMs} ms.`,
    );
  }

  async getVramSnapshot() {
    try {
      const response = await this.httpClient.get("/system_stats");
      const devices = Array.isArray(response?.data?.devices) ? response.data.devices : [];
      const device =
        devices.find(
          (candidate) =>
            typeof candidate?.type === "string" && candidate.type.toLowerCase().includes("cuda"),
        ) ?? devices[0];
      if (
        !device ||
        !Number.isFinite(device.vram_total) ||
        !Number.isFinite(device.vram_free) ||
        device.vram_total <= 0
      ) {
        throw new ComfyUiError("ComfyUI did not report usable VRAM statistics.");
      }
      return {
        device: device.name ?? device.type ?? "unknown",
        totalBytes: device.vram_total,
        freeBytes: device.vram_free,
      };
    } catch (error) {
      throw normalizeHttpError(error, "inspect VRAM usage");
    }
  }

  async releaseModelsForExternalInference() {
    await this.waitUntilIdle();
    const before = await this.getVramSnapshot();

    try {
      await this.httpClient.post("/free", {
        unload_models: true,
        free_memory: true,
      });
    } catch (error) {
      throw normalizeHttpError(error, "unload models and free memory");
    }

    const startedAt = this.now();
    let previousFreeBytes = null;
    let stableSamples = 0;

    while (this.now() - startedAt < this.config.cleanupTimeoutMs) {
      const queue = await this.getQueueState();
      if (!queue.idle) {
        throw new GpuHandoffError(
          "ComfyUI started another job during GPU cleanup; Ollama inference was not started.",
        );
      }

      const current = await this.getVramSnapshot();
      const stableThresholdBytes = 32 * 1024 * 1024;
      if (
        previousFreeBytes !== null &&
        Math.abs(current.freeBytes - previousFreeBytes) <= stableThresholdBytes
      ) {
        stableSamples += 1;
      } else {
        stableSamples = 1;
      }
      previousFreeBytes = current.freeBytes;

      const alreadyMostlyFree = before.freeBytes / before.totalBytes >= this.config.cleanupFreeRatio;
      const nowMostlyFree = current.freeBytes / current.totalBytes >= this.config.cleanupFreeRatio;
      const releasedEnough =
        current.freeBytes - before.freeBytes >= this.config.cleanupMinReleaseBytes;

      if (
        nowMostlyFree &&
        (alreadyMostlyFree || releasedEnough) &&
        stableSamples >= this.config.cleanupStableSamples
      ) {
        return {
          durationMs: this.now() - startedAt,
          beforeFreeBytes: before.freeBytes,
          afterFreeBytes: current.freeBytes,
          totalBytes: current.totalBytes,
          device: current.device,
        };
      }
      await this.sleep(this.config.cleanupPollIntervalMs);
    }

    throw new GpuHandoffError(
      `ComfyUI GPU cleanup could not be verified within ${this.config.cleanupTimeoutMs} ms.`,
      {
        details: {
          beforeFreeBytes: before.freeBytes,
          totalBytes: before.totalBytes,
        },
      },
    );
  }

  async getHistoryEntry(promptId) {
    try {
      const response = await this.httpClient.get(`/history/${encodeURIComponent(promptId)}`);
      return response?.data?.[promptId] ?? null;
    } catch (error) {
      throw normalizeHttpError(error, "read generation history");
    }
  }

  async waitForCompletion(promptId) {
    const startedAt = this.now();

    while (this.now() - startedAt < this.config.timeoutMs) {
      const historyEntry = await this.getHistoryEntry(promptId);
      if (historyEntry) {
        const failureMessage = executionFailureFromHistory(historyEntry);
        if (failureMessage) {
          throw new GenerationFailedError(failureMessage, { details: { promptId } });
        }

        if (historyEntry.status?.status_str === "error") {
          throw new GenerationFailedError("ComfyUI marked the generation as failed.", {
            details: { promptId },
          });
        }

        if (
          historyEntry.status?.completed === true ||
          (historyEntry.outputs && Object.keys(historyEntry.outputs).length > 0)
        ) {
          return historyEntry;
        }
      }
      await this.sleep(this.config.pollIntervalMs);
    }

    throw new GenerationTimeoutError(
      `ComfyUI did not finish generation within ${this.config.timeoutMs} ms.`,
      { details: { promptId } },
    );
  }

  getOutputImage(historyEntry) {
    return extractOutputImage(historyEntry, this.config.mappings.saveImageNodeId);
  }

  async downloadImage(imageMetadata) {
    const safeMetadata = assertSafeImageMetadata(imageMetadata);
    try {
      const response = await this.httpClient.get("/view", {
        params: safeMetadata,
        responseType: "arraybuffer",
      });
      const contentType = response?.headers?.["content-type"];
      if (typeof contentType === "string" && !contentType.startsWith("image/")) {
        throw new ComfyUiError(`ComfyUI returned an unexpected content type: ${contentType}`);
      }
      const buffer = Buffer.from(response?.data ?? []);
      if (buffer.length === 0) {
        throw new ComfyUiError("ComfyUI returned an empty image response.");
      }
      return { buffer, filename: safeMetadata.filename };
    } catch (error) {
      throw normalizeHttpError(error, "download the generated image");
    }
  }
}
