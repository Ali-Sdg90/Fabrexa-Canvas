import "dotenv/config";

import { createBot } from "./bot/bot.js";
import { loadConfig } from "./config/index.js";
import { ActivityLogService } from "./services/activity-log.service.js";
import { ComfyUIService } from "./services/comfyui.service.js";
import { GenerationQueue } from "./services/generation-queue.service.js";
import { GenerationService } from "./services/generation.service.js";
import { GpuHandoffService } from "./services/gpu-handoff.service.js";
import { OllamaService } from "./services/ollama.service.js";
import { PromptEnhancementService } from "./services/prompt-enhancement.service.js";
import { PromptService } from "./services/prompt.service.js";
import { UserDataService } from "./services/user-data.service.js";
import { createLogger } from "./utils/logger.js";

async function main() {
  let config;
  let logger = createLogger();

  try {
    config = loadConfig();
    logger = createLogger({
      ...config.logging,
      redactions: [config.telegram.botToken],
    });
  } catch (error) {
    logger.error("Configuration validation failed.", { error });
    process.exitCode = 1;
    return;
  }

  const comfyUiService = new ComfyUIService(config.comfyUi, logger);
  const ollamaService = new OllamaService(config.ollama, logger);
  const promptEnhancementService = new PromptEnhancementService(
    config.promptEnhancement,
    ollamaService,
    logger,
  );
  const gpuHandoffService = new GpuHandoffService({
    comfyUiService,
    ollamaService,
    pollIntervalMs: config.ollama.pollIntervalMs,
    logger,
  });
  const activityLogService = new ActivityLogService({ ...config.activityLog, logger });
  const userDataService = new UserDataService({ ...config.userData, logger });
  const promptService = new PromptService(config.prompt);
  const generationQueue = new GenerationQueue({ ...config.queue, logger });
  const generationService = new GenerationService({
    promptService,
    comfyUiService,
    promptEnhancementService,
    gpuHandoffService,
    fixedSeed: config.seed.fixed,
  });

  try {
    await activityLogService.initialize();
    await userDataService.initialize();
    await comfyUiService.initialize();
    await promptEnhancementService.initialize();
  } catch (error) {
    logger.error("Fabrexa Canvas could not start.", { error });
    process.exitCode = 1;
    return;
  }

  const bot = createBot({
    config,
    generationService,
    generationQueue,
    activityLogService,
    userDataService,
    logger,
  });
  let stopping = false;

  const stop = (signal) => {
    if (stopping) {
      return;
    }
    stopping = true;
    generationQueue.close();
    logger.info("Stopping Fabrexa Canvas.", { signal });
    bot.stop(signal);
  };

  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.on("unhandledRejection", (error) => {
    logger.error("Unhandled promise rejection.", { error });
  });

  try {
    await bot.launch({ allowedUpdates: ["message", "callback_query"] });
    logger.info("Fabrexa Canvas is running with Telegram long polling.");
  } catch (error) {
    logger.error("Telegram polling could not start.", { error });
    process.exitCode = 1;
  }
}

await main();
