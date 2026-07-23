// Seed reference data: the 12 target markets, default campaign + cadence,
// and the owner user. Idempotent — safe to re-run.
// Usage: node scripts/seed.mjs   (requires DATABASE_URL)
import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const MARKETS = [
  { key: "columbus_oh",     city: "Columbus",     state: "OH", counties: ["Franklin"],            tz: "America/New_York" },
  { key: "toledo_oh",       city: "Toledo",       state: "OH", counties: ["Lucas"],               tz: "America/New_York" },
  { key: "san_antonio_tx",  city: "San Antonio",  state: "TX", counties: ["Bexar"],               tz: "America/Chicago" },
  { key: "houston_tx",      city: "Houston",      state: "TX", counties: ["Harris"],              tz: "America/Chicago" },
  { key: "jacksonville_fl", city: "Jacksonville", state: "FL", counties: ["Duval"],               tz: "America/New_York" },
  { key: "orlando_fl",      city: "Orlando",      state: "FL", counties: ["Orange"],              tz: "America/New_York" },
  { key: "atlanta_ga",      city: "Atlanta",      state: "GA", counties: ["Fulton", "DeKalb"],    tz: "America/New_York" },
  { key: "augusta_ga",      city: "Augusta",      state: "GA", counties: ["Richmond"],            tz: "America/New_York" },
  { key: "memphis_tn",      city: "Memphis",      state: "TN", counties: ["Shelby"],              tz: "America/Chicago" },
  { key: "knoxville_tn",    city: "Knoxville",    state: "TN", counties: ["Knox"],                tz: "America/New_York" },
  { key: "indianapolis_in", city: "Indianapolis", state: "IN", counties: ["Marion"],              tz: "America/Indiana/Indianapolis" },
  { key: "baltimore_md",    city: "Baltimore",    state: "MD", counties: ["Baltimore City", "Baltimore"], tz: "America/New_York" },
];

const SOURCES = [
  { key: "batchdata", name: "BatchData API", vendor: "BatchData", cost: 2 },
  { key: "attom", name: "ATTOM Data", vendor: "ATTOM", cost: 0 },
  { key: "county_records", name: "County records import", vendor: "manual", cost: 0 },
  { key: "driving_for_dollars", name: "Driving for Dollars", vendor: "manual", cost: 0 },
];

const client = new Client({ connectionString: databaseUrl });
await client.connect();

for (const m of MARKETS) {
  await client.query(
    `INSERT INTO markets (key, city, state, counties, timezone)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (key) DO UPDATE SET counties = EXCLUDED.counties, timezone = EXCLUDED.timezone`,
    [m.key, m.city, m.state, m.counties, m.tz],
  );
}
console.log(`seeded ${MARKETS.length} markets`);

for (const s of SOURCES) {
  await client.query(
    `INSERT INTO lead_sources (key, name, vendor, cost_per_record_cents)
     VALUES ($1,$2,$3,$4) ON CONFLICT (key) DO NOTHING`,
    [s.key, s.name, s.vendor, s.cost],
  );
}

await client.query(
  `INSERT INTO campaigns (key, name, config)
   VALUES ('default_cold', 'Default cold outreach', '{"cadence":"default_6_week"}')
   ON CONFLICT (key) DO NOTHING`,
);

const ownerEmail = process.env.OWNER_EMAIL ?? "owner@example.com";
await client.query(
  `INSERT INTO users (email, name, role, phone)
   VALUES ($1, $2, 'owner', $3)
   ON CONFLICT (email) DO NOTHING`,
  [ownerEmail, process.env.OWNER_NAME ?? "David", process.env.OWNER_PHONE ?? null],
);

console.log("seed complete");
await client.end();
