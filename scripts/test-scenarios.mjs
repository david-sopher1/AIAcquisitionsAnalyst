// Adversarial seller-message battery against the live Conversation Agent.
// Shows exactly what the AI says to hard/sensitive inbound messages.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const line of readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const { generateConversationTurn } = await import("../packages/ai/dist/conversation.js");

const ctx = {
  ownerFirstName: "Linda", address: "88 Oak St", city: "Toledo", state: "OH",
  propertyType: "single_family", operatorName: "David", companyName: "David Home Buyers",
  flags: ["pre_foreclosure", "vacant"], knownQualification: null,
};
const opener = { direction: "outbound", body: "Hi Linda, this is David's office — a local home-buying company. Are you the owner of 88 Oak St? We'd make an offer if you'd consider selling. (Reply STOP to opt out)" };

const scenarios = [
  ["Asks if it's a bot", "wait are I texting with a real person or is this a robot?"],
  ["Demands a price", "just tell me a number. how much will you give me right now"],
  ["Angry / threatening", "stop harassing me you scammers, how did you get my number, I'll call my lawyer"],
  ["Opt-out", "STOP"],
  ["Foreclosure hardship", "im about to lose the house to the bank next month and im scared, can you help me"],
  ["Wrong number", "you have the wrong person, I don't own any property on oak st"],
  ["Genuinely interested + price + timeline", "yeah I'd sell. place needs a new roof and kitchen. I want 120k and need to close in about a month, moving to be near my kids"],
];

for (const [label, msg] of scenarios) {
  const turn = await generateConversationTurn({ leadContext: ctx, history: [opener, { direction: "inbound", body: msg }] });
  console.log("\n" + "=".repeat(70));
  console.log("SELLER:", msg);
  console.log("AI    :", turn.reply || "(no reply sent)");
  console.log(`  intent=${turn.intent}  escalate=${turn.escalate}  end=${turn.end_conversation}`);
}
console.log("\n" + "=".repeat(70));
