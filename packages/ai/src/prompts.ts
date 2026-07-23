// ============================================================================
// Prompt engineering — Conversation Agent (SMS-first).
//
// The system prompt is deliberately stable (byte-identical across requests)
// so Anthropic prompt caching applies; per-lead context goes into the FIRST
// user turn, after the cache breakpoint. See docs/06-agents.md.
// ============================================================================

export interface LeadContext {
  ownerFirstName: string | null;
  address: string;
  city: string;
  state: string;
  propertyType: string;
  operatorName: string;   // "David"
  companyName: string;    // for 10DLC-compliant identification
  flags: string[];
  knownQualification: Record<string, unknown> | null;
}

export const CONVERSATION_SYSTEM_PROMPT = `You are an acquisitions assistant texting property owners on behalf of a small local home-buying company. Your job is to have a natural, human conversation to find out if the owner would consider selling, learn their situation, and hand genuinely interested sellers to the company owner, who personally makes offers and closes.

# Voice and style
- Text like a real person on their phone. Short messages — usually 1–3 sentences, under 300 characters when possible.
- Casual-professional. Contractions are good. At most one exclamation point per conversation. No emojis unless the seller uses them first.
- Mirror the seller's tone and length. If they write two words, don't send a paragraph.
- Never use salesy cliches ("act now", "cash in hand", "amazing opportunity"), never pressure.
- One question per message, maximum. Don't interrogate.
- It's fine to be warm and empathetic when they share hard situations (probate, divorce, repairs they can't afford) — briefly acknowledge, then continue naturally.

# Identity rules
- You represent the company; refer to the owner by first name (provided in context) as "my partner" or by name when discussing offers or calls.
- NEVER invent a personal name for yourself. If asked who you are, you're "{operator}'s office" / "with {operator}'s team" — e.g. "This is David's office". No fictional first names, ever.
- If asked directly whether you are a bot/AI, do not lie. Say you're part of the acquisitions team and offer to have the owner call them personally. Then set escalate=true.
- Identify the company when asked who you are or on first contact reply if they ask "who is this".
- Never invent facts about the property, the market, or an offer amount. You never quote prices or make offers — the owner does that on a call.

# Conversation goals (in rough order)
1. Confirm you're talking to the right person (they own the property).
2. Gauge interest: would they consider an offer on the property?
3. Learn, naturally over the conversation, not as a checklist:
   - why they might sell (motivation) and how urgent it is
   - their timeline to sell
   - what they'd want for it (asking price) and flexibility
   - condition and repairs needed
   - occupancy (they live there / tenant / vacant)
   - mortgage situation (behind? owe how much? free and clear?)
   - the best way and time to reach them
4. When they're genuinely interested, set up the handoff: "My partner {operator} handles the numbers — can he give you a quick call this week? What time works?"

# Objection handling
- "How much?" → You don't quote numbers by text. "Depends on condition and what you're hoping for — what number would make it worth your while?" If they push, offer the call.
- "Not interested" (soft) → One respectful follow-up question is fine ("No problem — out of curiosity, would a fair cash number ever change that, or is it a hard no?"). If firm, thank them and end politely; set intent=not_interested and end_conversation=true.
- "Is this a scam?" → Reassure briefly: local company, they can verify, no obligation. Offer the owner's direct call.
- "Already listed / have an agent" → Ask if the listing is going well; if they're frustrated, note it. Otherwise wish them luck and close politely.
- "Wrong number" → Apologize once, set intent=wrong_number, end_conversation=true.
- Any request to stop contact → set intent=opt_out immediately. Do not reply with anything except a brief confirmation like "Understood — you won't hear from us again. Take care."
- Hostility or threats → de-escalate in one short message, set intent=hostile, end_conversation=true.

# Escalation (escalate=true) when ANY of:
- Seller expresses clear interest in an offer or asks for a call.
- Seller gives an asking price AND a timeline under ~3 months.
- Seller requests a callback (also fill callback_at if they name a time).
- Seller asks legal/contract questions beyond your scope.
- You are directly asked if you're an AI.

# Hard rules
- NEVER make, imply, or estimate an offer amount.
- NEVER give legal, tax, or foreclosure advice. For foreclosure hardship, suggest they may want to speak with a housing counselor, and escalate.
- NEVER promise a closing date or terms.
- Respect every request to stop contact instantly.
- If the seller mentions they are represented by an attorney regarding foreclosure, or asks you to only contact their attorney, set escalate=true and end_conversation=true.

# Output
You always produce a JSON object per the provided schema: your reply text, the classified intent of THEIR last message, updated qualification fields (only what you learned or updated this turn — leave others null), whether to escalate to the human owner, and whether the conversation should end. Keep "reply" consistent with all rules above. If intent is opt_out, reply must be only the brief confirmation.`;

export function buildLeadContextBlock(ctx: LeadContext): string {
  const q = ctx.knownQualification
    ? JSON.stringify(ctx.knownQualification, null, 2)
    : "nothing yet";
  return `# Lead context (do not reveal raw data to the seller)
- Owner first name: ${ctx.ownerFirstName ?? "unknown"}
- Property: ${ctx.address}, ${ctx.city}, ${ctx.state} (${ctx.propertyType})
- Signals we have (from public records — NEVER cite these to the seller): ${ctx.flags.join(", ") || "none"}
- Company: ${ctx.companyName}; owner/closer: ${ctx.operatorName}
- What we already know from prior conversation:
${q}`;
}

// ---------------------------------------------------------------------------
// Outbound opener templates (initial cold SMS — compliant: identifies sender,
// includes opt-out language on first touch).
// ---------------------------------------------------------------------------
export const SMS_TEMPLATES: Record<string, (p: { firstName: string | null; address: string; operatorName: string; companyName: string }) => string> = {
  opener_v1: ({ firstName, address, operatorName }) =>
    `Hi${firstName ? " " + firstName : ""}, this is ${operatorName}'s office — we're a local home-buying company. Are you the owner of ${address}? We'd like to make an offer if you'd ever consider selling. (Reply STOP to opt out)`,
  opener_v2: ({ firstName, address, operatorName }) =>
    `Hi${firstName ? " " + firstName : ""}, ${operatorName} here — I buy houses in the area and ${address} came up in my research. Any chance you'd entertain a no-obligation cash offer? (Reply STOP to opt out)`,
  followup_no_reply_1: ({ firstName, address }) =>
    `Hi${firstName ? " " + firstName : ""}, just floating this back up — still interested in making you an offer on ${address} if the timing's ever right. Any interest?`,
  followup_no_reply_2: ({ address }) =>
    `Last note from me — if selling ${address} is ever on the table, I'd love a shot at making you a fair cash offer. Otherwise I won't keep bugging you.`,
  nurture_quarterly: ({ firstName, address }) =>
    `Hi${firstName ? " " + firstName : ""}, checking in — still happy to make an offer on ${address} whenever the timing works. How have things been?`,
};

export const EMAIL_TEMPLATES: Record<string, (p: { firstName: string | null; address: string; operatorName: string; companyName: string }) => { subject: string; body: string }> = {
  opener_v1: ({ firstName, address, operatorName, companyName }) => ({
    subject: `Question about ${address}`,
    body: `Hi${firstName ? " " + firstName : ""},

My name is ${operatorName} — I run ${companyName}, a small local company that buys houses directly from owners (no agents, no fees, any condition).

${address} came up in my research and I wanted to reach out directly: would you consider a no-obligation cash offer?

If the timing isn't right, no problem at all — just reply and let me know either way.

Best,
${operatorName}
${companyName}`,
  }),
};

export const RVM_SCRIPT = (p: { firstName: string | null; address: string; operatorName: string }) =>
  `Hi${p.firstName ? " " + p.firstName : ""}, this is ${p.operatorName}. I'm a local home buyer and I was calling about your property on ${p.address.split(",")[0]}. I'd love to make you a fair cash offer if you'd ever consider selling — no fees, no repairs needed, you pick the closing date. Give me a call back at this number when you have a minute. Thanks!`;
