import { generateSeed } from "../utils/seed.js";

export class GenerationService {
  constructor({ promptService, comfyUiService, seedGenerator = generateSeed, now = Date.now }) {
    this.promptService = promptService;
    this.comfyUiService = comfyUiService;
    this.seedGenerator = seedGenerator;
    this.now = now;
  }

  prepareRequest(rawPrompt) {
    return Object.freeze({
      prompt: this.promptService.prepare(rawPrompt),
      seed: this.seedGenerator(),
    });
  }

  async generate({ prompt, seed }) {
    const startedAt = this.now();
    const workflow = this.comfyUiService.createWorkflow(prompt, seed);
    const promptId = await this.comfyUiService.submitWorkflow(workflow);
    const historyEntry = await this.comfyUiService.waitForCompletion(promptId);
    const outputImage = this.comfyUiService.getOutputImage(historyEntry);
    const image = await this.comfyUiService.downloadImage(outputImage);

    return Object.freeze({
      ...image,
      promptId,
      durationMs: this.now() - startedAt,
    });
  }
}
