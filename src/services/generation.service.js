import { generateSeed } from "../utils/seed.js";
import { PromptEnhancementError } from "../utils/errors.js";

export class GenerationService {
  constructor({
    promptService,
    comfyUiService,
    promptEnhancementService,
    gpuHandoffService,
    seedGenerator = generateSeed,
    fixedSeed = null,
    now = Date.now,
  }) {
    this.promptService = promptService;
    this.comfyUiService = comfyUiService;
    this.promptEnhancementService = promptEnhancementService;
    this.gpuHandoffService = gpuHandoffService;
    this.seedGenerator = seedGenerator;
    this.fixedSeed = fixedSeed;
    this.now = now;
  }

  get enhancementEnabled() {
    return this.promptEnhancementService?.enabled === true;
  }

  prepareRequest(rawPrompt) {
    return Object.freeze({
      prompt: this.promptService.prepare(rawPrompt),
      seed: this.fixedSeed ?? this.seedGenerator(),
    });
  }

  async generate({ prompt, seed }, { onStage = async () => undefined } = {}) {
    const startedAt = this.now();
    let promptUsed = prompt;
    let enhanced = false;
    let fallbackUsed = false;
    const timings = {
      comfyReleaseMs: 0,
      ollamaStartupMs: 0,
      gemmaInferenceMs: 0,
      ollamaUnloadMs: 0,
      comfyReadyMs: 0,
      comfyGenerationMs: 0,
    };
    let modelMetrics;

    if (this.enhancementEnabled) {
      await onStage({ stage: "preparing_scene", prompt });
      const releaseResult = await this.gpuHandoffService.prepareForLanguageModel();
      timings.comfyReleaseMs = releaseResult.durationMs;

      try {
        const languageStage = await this.gpuHandoffService.runLanguageModelStage((signal) =>
          this.promptEnhancementService.enhance(prompt, { signal }),
        );
        promptUsed = languageStage.inferenceResult.prompt;
        enhanced = languageStage.inferenceResult.enhanced;
        modelMetrics = languageStage.inferenceResult.modelMetrics;
        Object.assign(timings, languageStage.inferenceResult.timings);
        timings.ollamaUnloadMs = languageStage.unloadResult.durationMs;
      } catch (error) {
        if (
          this.promptEnhancementService.config.fallbackToRaw &&
          error instanceof PromptEnhancementError
        ) {
          fallbackUsed = true;
          promptUsed = prompt;
        } else {
          throw error;
        }
      }

      await onStage({ stage: "preparing_image", prompt: promptUsed });
      const readyResult = await this.gpuHandoffService.prepareForImageGeneration();
      timings.comfyReadyMs = readyResult.durationMs;
    }

    await onStage({ stage: "generating_image", prompt: promptUsed });
    const comfyStartedAt = this.now();
    const workflow = this.comfyUiService.createWorkflow(promptUsed, seed);
    const promptId = await this.comfyUiService.submitWorkflow(workflow);
    const historyEntry = await this.comfyUiService.waitForCompletion(promptId);
    const outputImage = this.comfyUiService.getOutputImage(historyEntry);
    const image = await this.comfyUiService.downloadImage(outputImage);
    timings.comfyGenerationMs = this.now() - comfyStartedAt;
    timings.totalMs = this.now() - startedAt;

    return Object.freeze({
      ...image,
      promptId,
      originalPrompt: prompt,
      prompt: promptUsed,
      enhanced,
      fallbackUsed,
      modelMetrics,
      timings: Object.freeze(timings),
      durationMs: timings.totalMs,
    });
  }
}
