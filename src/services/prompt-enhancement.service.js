import { readFile } from "node:fs/promises";

import { PromptEnhancementError } from "../utils/errors.js";

const UNUSABLE_OPENING_PATTERN =
  /^(?:i\s+(?:cannot|can't|won't|am unable to)|sorry\b|as an ai\b|here(?:'s| is)\s+(?:the|your)\s+(?:prompt|image prompt)|certainly[,!]?\s+(?:here|i))/i;
const LEADING_LABEL_PATTERN = /^(?:(?:positive|image(?:-generation)?)\s+)?prompt\s*:\s*/i;

function buildSceneDirectorUserMessage(originalPrompt) {
  return `Transform only the user input delimited below into one positive image prompt.

<user_input>
${originalPrompt}
</user_input>

Before answering, preserve every explicit constraint. Do not infer age, religion, head covering, cultural clothing, skin tone, hairstyle, relationships, or extra decorative objects from nationality or ethnicity. Keep explicit SFW and no-text requirements in the final prompt. Output only the finished prompt.`;
}

export function normalizeEnhancedPrompt(rawOutput, maxLength) {
  if (typeof rawOutput !== "string") {
    throw new PromptEnhancementError("The scene director returned a non-text response.");
  }

  let prompt = rawOutput.trim();
  if (prompt.startsWith("```") && prompt.endsWith("```")) {
    prompt = prompt.replace(/^```(?:text)?\s*/i, "").replace(/\s*```$/, "").trim();
  }

  const matchingQuote =
    (prompt.startsWith('"') && prompt.endsWith('"')) ||
    (prompt.startsWith("'") && prompt.endsWith("'"));
  if (matchingQuote) {
    prompt = prompt.slice(1, -1).trim();
  }
  prompt = prompt.replace(LEADING_LABEL_PATTERN, "").trim();

  prompt = prompt.replace(/\s+/g, " ").trim();
  if (!prompt) {
    throw new PromptEnhancementError("The scene director returned an empty prompt.");
  }
  if (UNUSABLE_OPENING_PATTERN.test(prompt)) {
    throw new PromptEnhancementError(
      "The scene director returned a refusal or conversational response instead of an image prompt.",
    );
  }
  if (prompt.length > maxLength) {
    throw new PromptEnhancementError(
      `The enhanced prompt exceeds the configured ${maxLength}-character limit.`,
    );
  }
  return prompt;
}

export class PromptEnhancementService {
  constructor(
    config,
    ollamaService,
    logger,
    { readPromptFile = readFile, now = Date.now } = {},
  ) {
    this.config = config;
    this.ollamaService = ollamaService;
    this.logger = logger;
    this.readPromptFile = readPromptFile;
    this.now = now;
    this.systemPrompt = null;
  }

  get enabled() {
    return this.config.enabled;
  }

  async initialize() {
    if (!this.enabled) {
      return;
    }

    let content;
    try {
      content = await this.readPromptFile(this.config.systemPromptPath, "utf8");
    } catch (error) {
      throw new PromptEnhancementError(
        `Could not read the scene-director system prompt at "${this.config.systemPromptPath}".`,
        { cause: error },
      );
    }

    this.systemPrompt = content.trim();
    if (!this.systemPrompt) {
      throw new PromptEnhancementError("The scene-director system prompt file is empty.");
    }
    this.logger.info("Scene-director system prompt loaded.", {
      systemPromptPath: this.config.systemPromptPath,
      characterCount: this.systemPrompt.length,
    });
  }

  async enhance(originalPrompt, { signal } = {}) {
    if (!this.enabled) {
      return {
        prompt: originalPrompt,
        enhanced: false,
        timings: { ollamaStartupMs: 0, gemmaInferenceMs: 0 },
      };
    }
    if (!this.systemPrompt) {
      throw new PromptEnhancementError(
        "PromptEnhancementService must be initialized before enhancement.",
      );
    }

    const startup = await this.ollamaService.ensureReady();
    await this.ollamaService.assertModelInstalled();

    const inferenceStartedAt = this.now();
    const response = await this.ollamaService.generateScenePrompt({
      userPrompt: buildSceneDirectorUserMessage(originalPrompt),
      systemPrompt: this.systemPrompt,
      signal,
    });
    const prompt = normalizeEnhancedPrompt(response.content, this.config.maxOutputLength);

    return {
      prompt,
      enhanced: true,
      timings: {
        ollamaStartupMs: startup.durationMs,
        gemmaInferenceMs: this.now() - inferenceStartedAt,
      },
      modelMetrics: response.metrics,
    };
  }
}
