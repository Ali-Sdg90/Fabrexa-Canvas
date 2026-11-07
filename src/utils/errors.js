export class AppError extends Error {
  constructor(message, { code = "APP_ERROR", cause, details } = {}) {
    super(message, { cause });
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

export class ConfigError extends AppError {
  constructor(message, options = {}) {
    super(message, { code: "CONFIG_ERROR", ...options });
  }
}

export class WorkflowError extends AppError {
  constructor(message, options = {}) {
    super(message, { code: "WORKFLOW_ERROR", ...options });
  }
}

export class ComfyUiError extends AppError {
  constructor(message, options = {}) {
    super(message, { code: "COMFYUI_ERROR", ...options });
  }
}

export class GenerationFailedError extends AppError {
  constructor(message, options = {}) {
    super(message, { code: "GENERATION_FAILED", ...options });
  }
}

export class GenerationTimeoutError extends AppError {
  constructor(message, options = {}) {
    super(message, { code: "GENERATION_TIMEOUT", ...options });
  }
}

export class QueueFullError extends AppError {
  constructor(message = "The generation queue is full.", options = {}) {
    super(message, { code: "QUEUE_FULL", ...options });
  }
}

export class PromptValidationError extends AppError {
  constructor(message, options = {}) {
    super(message, { code: "INVALID_PROMPT", ...options });
  }
}

export class ActivityLogError extends AppError {
  constructor(message, options = {}) {
    super(message, { code: "ACTIVITY_LOG_ERROR", ...options });
  }
}

export class OllamaError extends AppError {
  constructor(message, options = {}) {
    super(message, { code: "OLLAMA_ERROR", ...options });
  }
}

export class OllamaStartupError extends OllamaError {
  constructor(message, options = {}) {
    super(message, { code: "OLLAMA_STARTUP_ERROR", ...options });
  }
}

export class OllamaModelError extends OllamaError {
  constructor(message, options = {}) {
    super(message, { code: "OLLAMA_MODEL_ERROR", ...options });
  }
}

export class PromptEnhancementError extends AppError {
  constructor(message, options = {}) {
    super(message, { code: "PROMPT_ENHANCEMENT_ERROR", ...options });
  }
}

export class GpuHandoffError extends AppError {
  constructor(message, options = {}) {
    super(message, { code: "GPU_HANDOFF_ERROR", ...options });
  }
}
