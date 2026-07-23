// Notification transport — Slack incoming webhook.
import { getConfig, logger } from "@dealengine/shared";

export async function postSlack(params: {
  text: string;
  blocks?: unknown[];
}): Promise<boolean> {
  const cfg = getConfig();
  if (!cfg.SLACK_WEBHOOK_URL) return false;
  try {
    const res = await fetch(cfg.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: params.text, blocks: params.blocks }),
    });
    return res.ok;
  } catch (err) {
    logger.error({ err }, "slack post failed");
    return false;
  }
}
