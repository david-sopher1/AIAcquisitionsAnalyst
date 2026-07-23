// Temporal client — used to signal per-lead outreach workflows from webhooks.
import { Client, Connection } from "@temporalio/client";
import { getConfig, logger } from "@dealengine/shared";

let client: Client | null = null;

export async function getTemporal(): Promise<Client | null> {
  if (client) return client;
  try {
    const cfg = getConfig();
    const connection = await Connection.connect({
      address: cfg.TEMPORAL_ADDRESS,
      connectTimeout: 5_000,
    });
    client = new Client({ connection, namespace: cfg.TEMPORAL_NAMESPACE });
    return client;
  } catch (err) {
    logger.warn({ err }, "temporal unavailable — signals skipped");
    return null;
  }
}

/** Tell the lead's outreach workflow the seller replied (pause cadence). */
export async function signalSellerReplied(leadId: string): Promise<void> {
  const c = await getTemporal();
  if (!c) return;
  try {
    await c.workflow.getHandle(`outreach-${leadId}`).signal("sellerReplied");
  } catch {
    // No running outreach workflow for this lead — fine.
  }
}

export async function signalStopOutreach(leadId: string, reason: string): Promise<void> {
  const c = await getTemporal();
  if (!c) return;
  try {
    await c.workflow.getHandle(`outreach-${leadId}`).signal("stopOutreach", reason);
  } catch {
    /* no running workflow */
  }
}
