// One-time setup: create Temporal Schedules for the daily pipeline (per
// market) and nightly KPI rollups. Run: npm run schedules -w @dealengine/workers
import { Client, Connection, ScheduleOverlapPolicy } from "@temporalio/client";
import { getConfig, logger, query } from "@dealengine/shared";

const TASK_QUEUE = "dealengine-main";

async function main() {
  const cfg = getConfig();
  const connection = await Connection.connect({ address: cfg.TEMPORAL_ADDRESS });
  const client = new Client({ connection, namespace: cfg.TEMPORAL_NAMESPACE });

  const markets = await query<{ key: string }>(`SELECT key FROM markets WHERE active`);

  for (const { key } of markets.rows) {
    const scheduleId = `daily-pipeline-${key}`;
    try {
      await client.schedule.create({
        scheduleId,
        spec: {
          // 6:00 AM Eastern daily; stagger markets by hash to spread vendor load
          cronExpressions: [`${hashMinute(key)} 10 * * *`], // 10:xx UTC ≈ 5–6am CT/ET
        },
        action: {
          type: "startWorkflow",
          workflowType: "dailyPipeline",
          args: [{ marketKey: key }],
          taskQueue: TASK_QUEUE,
          workflowId: `daily-pipeline-run-${key}`,
        },
        policies: { overlap: ScheduleOverlapPolicy.SKIP },
      });
      logger.info({ scheduleId }, "schedule created");
    } catch (err) {
      logger.info({ scheduleId, err: String(err) }, "schedule exists or failed");
    }
  }

  await connection.close();
}

function hashMinute(key: string): number {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) % 55;
  return h;
}

main().catch((err) => {
  logger.error({ err }, "schedule setup failed");
  process.exit(1);
});
