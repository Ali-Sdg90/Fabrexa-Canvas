const LEVEL_PRIORITY = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });
const SENSITIVE_KEY_PATTERN = /token|authorization|password|secret/i;

function sanitize(value, redactions, seen = new WeakSet()) {
  if (typeof value === "string") {
    return redactions.reduce(
      (sanitizedValue, secret) => sanitizedValue.replaceAll(secret, "[REDACTED]"),
      value,
    );
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      code: value.code,
      message: sanitize(value.message, redactions, seen),
      stack: sanitize(value.stack, redactions, seen),
      details: sanitize(value.details, redactions, seen),
    };
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, redactions, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : sanitize(item, redactions, seen),
    ]),
  );
}

export function createLogger({ level = "info", sink = console, redactions = [] } = {}) {
  const threshold = LEVEL_PRIORITY[level] ?? LEVEL_PRIORITY.info;
  const secretValues = redactions.filter(
    (value) => typeof value === "string" && value.length > 0,
  );

  function write(logLevel, message, fields = {}) {
    if (LEVEL_PRIORITY[logLevel] < threshold) {
      return;
    }
    const record = JSON.stringify({
      timestamp: new Date().toISOString(),
      level: logLevel,
      message,
      ...sanitize(fields, secretValues),
    });
    const sinkMethod = logLevel === "debug" ? "log" : logLevel;
    (sink[sinkMethod] ?? sink.log).call(sink, record);
  }

  return Object.freeze({
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
  });
}
