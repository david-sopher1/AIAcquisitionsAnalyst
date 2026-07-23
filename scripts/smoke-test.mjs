// Smoke test: exercise ingest → dedupe/list-stack → score → underwrite-shape
// with a synthetic lead. No vendor keys required. Safe to re-run.
// Usage: node scripts/smoke-test.mjs
import { ingestRawLead } from "../packages/core/dist/ingest.js";
import { scoreAndPersist } from "../packages/core/dist/score.js";
import { closePool, query } from "../packages/shared/dist/index.js";

const fakeLead = {
  sourceKey: "county_records",
  marketKey: "columbus_oh",
  address: { line1: "1234 Test Ave", city: "Columbus", state: "OH", zip: "43205", county: "Franklin" },
  ownerName: "SMOKETEST JOHN",
  ownerMailing: { line1: "999 Elsewhere Rd", city: "Phoenix", state: "AZ", zip: "85001" },
  propertyType: "single_family",
  beds: 3, baths: 1, sqft: 1250, yearBuilt: 1948, units: 1,
  assessedValueCents: 9_800_000,
  estEquityPct: 0.85,
  flags: ["vacant", "tax_delinquent", "out_of_state_owner", "high_equity"],
  raw: { smoke: true },
};

console.log("1. ingest...");
const r1 = await ingestRawLead(fakeLead);
console.log("   lead:", r1.leadId, "new:", r1.isNew, "stack:", r1.stackCount);

console.log("2. re-ingest from a second source (list stacking)...");
const r2 = await ingestRawLead({ ...fakeLead, sourceKey: "driving_for_dollars" });
console.log("   same lead:", r2.leadId === r1.leadId, "stack now:", r2.stackCount);

console.log("3. score...");
const score = await scoreAndPersist(r1.leadId);
console.log("   score:", score);

const lead = await query(
  `SELECT l.status, l.score, l.score_breakdown, l.stack_count,
          (SELECT count(*) FROM lead_distress_flags f WHERE f.lead_id = l.id) AS flags
     FROM leads l WHERE l.id = $1`, [r1.leadId]);
console.log("4. persisted:", JSON.stringify(lead.rows[0], null, 2));

await closePool();
console.log("SMOKE TEST PASSED");
