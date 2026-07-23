import pg from "pg";
import { getConfig } from "./config.js";
import { logger } from "./logger.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: getConfig().DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on("error", (err) => logger.error({ err }, "pg pool error"));
  }
  return pool;
}

/** Typed single-statement query. */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params as never[]);
}

/** Convenience: first row or null. */
export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const res = await query<T>(text, params);
  return res.rows[0] ?? null;
}

/** Run a function inside a transaction. Rolls back on throw. */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Insert a row into audit_log. Never throws (audit must not break the flow). */
export async function audit(
  actor: string,
  action: string,
  entity: string,
  entityId: string | null,
  before?: unknown,
  after?: unknown,
): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_log (actor, action, entity, entity_id, before, after)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [actor, action, entity, entityId, before ?? null, after ?? null],
    );
  } catch (err) {
    logger.error({ err, action, entity }, "audit write failed");
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
