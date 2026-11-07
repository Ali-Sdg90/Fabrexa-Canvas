import { PromptValidationError } from "../utils/errors.js";

export class PromptService {
  constructor({ maxLength }) {
    this.maxLength = maxLength;
  }

  prepare(rawPrompt) {
    if (typeof rawPrompt !== "string") {
      throw new PromptValidationError("The prompt must be text.");
    }

    const prompt = rawPrompt.trim();
    if (!prompt) {
      throw new PromptValidationError("The prompt cannot be empty.");
    }
    if (prompt.length > this.maxLength) {
      throw new PromptValidationError(`The prompt exceeds ${this.maxLength} characters.`);
    }

    // Version 1 intentionally passes the user's words through without enhancement.
    return prompt;
  }
}
