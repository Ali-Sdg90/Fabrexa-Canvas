import {
  ComfyUiError,
  GenerationFailedError,
  GenerationTimeoutError,
  PromptValidationError,
  QueueFullError,
} from "../utils/errors.js";

export const WELCOME_MESSAGE = `Welcome to Fabrexa Canvas! 🎨

Turn your imagination into images.

Send me a description of what you'd like to create, and I'll bring it to life.`;

export const PRIVATE_BOT_MESSAGE = "Sorry, Fabrexa Canvas is a private bot.";
export const UNKNOWN_COMMAND_MESSAGE =
  "I don't recognize that command. Send a description of the image you'd like to create.";
export const TEXT_ONLY_MESSAGE =
  "Please send a text description of the image you'd like to create.";

function formatSettings(settings, seed) {
  return `⚙️ Generation Settings
Model: ${settings.model}
Steps: ${settings.steps}
CFG: ${settings.cfg.toFixed(1)}
Resolution: ${settings.width} × ${settings.height}
Sampler: ${settings.sampler} / ${settings.scheduler}
Seed: ${seed}`;
}

export function creatingMessage({ prompt, seed }, settings) {
  return `🎨 Creating your image...

📝 Prompt: ${prompt}

${formatSettings(settings, seed)}

⏳ Generating...`;
}

export function queuedMessage({ prompt, seed }, settings, position) {
  return `🎨 Your request is queued.

📝 Prompt: ${prompt}

${formatSettings(settings, seed)}

⏳ Queue position: ${position}`;
}

export function completedMessage({ prompt, seed }, settings, durationMs) {
  const durationSeconds = (durationMs / 1000).toFixed(1);
  return `✅ Your image is ready!

📝 Prompt: ${prompt}

${formatSettings(settings, seed)}

⏱ Completed in ${durationSeconds} seconds.`;
}

export const IMAGE_CAPTION = `✨ Your image is ready!

Generated with Fabrexa Canvas.`;

export function userFacingError(error, maxPromptLength) {
  if (error instanceof PromptValidationError) {
    return `Please send a description between 1 and ${maxPromptLength} characters.`;
  }
  if (error instanceof QueueFullError) {
    return "The generation queue is full right now. Please try again after a request finishes.";
  }
  if (error instanceof GenerationTimeoutError) {
    return "This image took longer than expected. ComfyUI may still finish it, so please check its queue before trying again.";
  }
  if (error instanceof GenerationFailedError) {
    return "ComfyUI could not complete this image. Please check the ComfyUI window for details.";
  }
  if (error instanceof ComfyUiError) {
    return "I couldn't communicate with ComfyUI. Make sure it is running locally, then try again.";
  }
  return "Something went wrong while creating your image. Please try again.";
}
