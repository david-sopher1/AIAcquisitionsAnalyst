import pino from "pino";

const level = process.env.LOG_LEVEL ?? "info";

export const logger = pino({
  level,
  base: { service: process.env.SERVICE_NAME ?? "dealengine" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "*.authToken",
      "*.apiKey",
      "*.password",
      "req.headers.authorization",
      "req.headers['x-api-key']",
    ],
    censor: "[redacted]",
  },
});

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
