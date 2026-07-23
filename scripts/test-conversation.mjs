// Live test of the Conversation Agent against the Anthropic API.
// Simulates a seller replying to our opener. No SMS is sent — this only
// exercises the Claude call and prints what WOULD happen.
// Usage: node scripts/test-conversation.mjs   (reads .env in platform/)
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Minimal .env loader (services get env from compose/shell; scripts load here)
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const line of readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}

const { generateConversationTurn } = await import("../packages/ai/dist/conversation.js");

const leadContext = {
  ownerFirstName: "John",
  address: "1234 Test Ave",
  city: "Columbus",
  state: "OH",
  propertyType: "single_family",
  operatorName: "David",
  companyName: "David Home Buyers",
  flags: ["vacant", "tax_delinquent", "out_of_state_owner", "high_equity"],
  knownQualification: null,
};

const history = [
  {
    direction: "outbound",
    body: "Hi John, this is David's office — we're a local home-buying company. Are you the owner of 1234 Test Ave? We'd like to make an offer if you'd ever consider selling. (Reply STOP to opt out)",
  },
  {
    direction: "inbound",
    body: "who is this? is this about my house on test ave? honestly the place has been sitting empty for a year, tenants trashed it and i live in phoenix now. what would you even pay for it",
  },
];

console.log("Seller said:", history[1].body);
console.log("\nCalling Claude...\n");

const turn = await generateConversationTurn({ leadContext, history });

console.log("AI REPLY  :", turn.reply);
console.log("INTENT    :", turn.intent);
console.log("ESCALATE  :", turn.escalate);
console.log("END CONVO :", turn.end_conversation);
console.log("SUMMARY   :", turn.conversation_summary);
console.log("\nEXTRACTED QUALIFICATION (non-null only):");
for (const [k, v] of Object.entries(turn.qualification)) {
  if (v !== null && !(Array.isArray(v) && v.length === 0)) console.log(`  ${k}: ${JSON.stringify(v)}`);
}
console.log("\nMODEL META:", JSON.stringify(turn.modelMeta));
