// Temporal worker entry — registers workflows + activities.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { NativeConnection, Worker } from "@temporalio/worker";
import { getConfig, logger } from "@dealengine/shared";
import * as activities from "./activities.js";

const TASK_QUEUE = "dealengine-main";

async function main() {
  const cfg = getConfig();
  const connection = await NativeConnection.connect({ address: cfg.TEMPORAL_ADDRESS });

  const worker = await Worker.create({
    connection,
    namespace: cfg.TEMPORAL_NAMESPACE,
    taskQueue: TASK_QUEUE,
    workflowsPath: path.join(path.dirname(fileURLToPath(import.meta.url)), "workflows"),
    activities,
    maxConcurrentActivityTaskExecutions: 20,
  });

  logger.info({ taskQueue: TASK_QUEUE }, "worker starting");
  await worker.run();
}

main().catch((err) => {
  logger.error({ err }, "worker crashed");
  process.exit(1);
});
