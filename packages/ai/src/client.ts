import Anthropic from "@anthropic-ai/sdk";
import { getConfig } from "@dealengine/shared";

let client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!client) {
    const cfg = getConfig();
    client = new Anthropic({
      apiKey: cfg.ANTHROPIC_API_KEY,
      maxRetries: 3,
      timeout: 120_000,
    });
  }
  return client;
}
