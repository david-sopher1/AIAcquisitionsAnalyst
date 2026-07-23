// Migration runner — applies db/migrations/*.sql in filename order, once each.
// Usage: node scripts/migrate.mjs   (requires DATABASE_URL)
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const migrationsDir = path.join(root, "db", "migrations");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();

await client.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
const appliedRes = await client.query("SELECT filename FROM schema_migrations");
const applied = new Set(appliedRes.rows.map((r) => r.filename));

let ran = 0;
for (const file of files) {
  if (applied.has(file)) continue;
  const sql = await readFile(path.join(migrationsDir, file), "utf8");
  console.log(`applying ${file}...`);
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
    await client.query("COMMIT");
    ran++;
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`FAILED ${file}:`, err.message);
    process.exit(1);
  }
}
console.log(ran === 0 ? "already up to date" : `applied ${ran} migration(s)`);
await client.end();
