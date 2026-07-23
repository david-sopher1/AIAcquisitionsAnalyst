// DealEngine API — Fastify bootstrap.
import Fastify from "fastify";
import formbody from "@fastify/formbody";
import { getConfig, logger } from "@dealengine/shared";
import { webhookRoutes } from "./routes/webhooks.js";
import { apiRoutes } from "./routes/api.js";

async function main() {
  const cfg = getConfig();
  const app = Fastify({
    logger: false, // we use pino directly
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(formbody); // Twilio posts application/x-www-form-urlencoded
  await app.register(webhookRoutes);
  await app.register(apiRoutes);

  app.setErrorHandler((err, req, reply) => {
    logger.error({ err, url: req.url }, "request error");
    reply.code(err.statusCode ?? 500).send({ error: "internal error" });
  });

  await app.listen({ port: cfg.API_PORT, host: "0.0.0.0" });
  logger.info({ port: cfg.API_PORT }, "api listening");

  const shutdown = async () => {
    logger.info("api shutting down");
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  logger.error({ err }, "api failed to start");
  process.exit(1);
});
