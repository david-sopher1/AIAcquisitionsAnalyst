# DealEngine — Agent Roster & Conversation Design

"Agents" in DealEngine are a mix of Claude-powered components and deterministic services. Each maps to a concrete module or workflow — there is no free-floating "agent framework." Claude is used only where judgment over natural language is required.

## 1. Roster

| Agent | Responsibility | Trigger | Inputs → Outputs | Type | Implemented in |
|---|---|---|---|---|---|
| **Lead Generation** | Pull distress-filtered property lists | `dailyPipeline` (per market, daily) | Market config → raw records | Deterministic | `services/workers` dailyPipeline + `integrations/batchdata`, `attom`, county pulls |
| **Data Cleaning** | Normalize addresses/names, dedupe on APN+FIPS, merge into `properties`/`owners` | After list pull | Raw records → clean upserts + dedupe stats | Deterministic | `services/workers` activity + `packages/shared` normalizers |
| **Property Intelligence** | ATTOM enrichment: detail, AVM, liens, foreclosure status | New/changed property | APN → enriched `properties` row | Deterministic | `integrations/attom` |
| **Skip Trace** | Contact discovery with waterfall (BatchData → IDI/Enformion on miss) | Property enriched, no contacts | Owner → `contacts` (phones/emails + confidence) | Deterministic | `integrations/batchdata`, waterfall hook |
| **Lead Scoring** | Weighted distress-signal score 0–100; Claude assist for ambiguous records nightly | After skip trace; nightly re-score | Signals → `leads.score` | Deterministic core + Claude assist (Batches API) | `packages/scoring` |
| **Conversation** | SMS-first seller dialogue | Inbound message signal | Thread + qualification state → reply draft | **Claude** (`AI_MODEL_CONVERSATION`) | `packages/ai` conversation engine |
| **SMS / Email / Voicemail / Cold-Call / Direct-Mail managers** | Channel adapters + cadence step execution; number rotation; template rendering | `leadOutreach` cadence steps | Step spec → compliance-gated vendor call | Deterministic | `integrations/*` + workers activities |
| **CRM Manager** | Postgres writes + optional one-way GHL mirror | Any lead mutation | Lead delta → DB + GHL | Deterministic | `packages/shared` + `integrations/ghl` |
| **Follow-Up Manager** | The multi-week cadence itself: timers, channel sequencing, abort-on-reply | Lead reaches `scored` | Lead + cadence profile → scheduled steps | Deterministic (Temporal) | `services/workers` `leadOutreach` workflow |
| **Qualification / Disposition Prep** | Structured extraction from every inbound message | Every inbound msg/call transcript | Message + thread → `qualifications` upsert | **Claude** (`AI_MODEL_EXTRACTION`) | `packages/ai` extraction |
| **Offer Calculator / Repair Estimator / Comparable Sales / Deal Analyzer** | ARV (weighted comps + AVM blend), repair $/sqft by level, MAO = ARV×rulePct − repairs − assignment fee, flip/rent/CoC/BRRRR | Lead reaches `warm`, or on demand | Property + comps → `valuations` | Deterministic | `packages/underwriting` |
| **Market Analyst** | KPI rollups per market (reply rates, cost/warm, funnel conversion) | Nightly | Raw events → analytics | Deterministic | workers nightly activity |
| **Dashboard** | Materialize `kpi_daily` | Nightly + on demand | Analytics → `kpi_daily` | Deterministic | workers |
| **Notification** | Slack + SMS + email fanout to David with Claude deal summary | Lead → `warm`/`hot`; system alerts | Lead + qualification + underwriting → formatted notification | Deterministic fanout, **Claude** summary (`AI_MODEL_SUMMARY`) | workers + `integrations/slack` |
| **Pipeline Manager** | The only writer of `leads.status`; enforces legal transitions | Any status-changing event | Event → transition or rejection | Deterministic | `packages/shared` state machine |

## 2. Conversation Agent — prompt engineering guide

The Conversation Agent is the highest-leverage prompt in the system. Its system prompt lives in `packages/ai/src/prompts/conversation.ts` and is assembled per-message from: persona rules + market/state compliance block + lead context (property facts, prior thread, current `qualifications` state) + goal state.

### 2.1 Persona rules

1. **Sound human, text like a human.** Lowercase-casual acceptable, contractions, occasional typos are NOT simulated (don't fake imperfection), 1–3 sentences per message, one question max per message. No paragraphs, ever.
2. **No exclamation spam.** Max one `!` per conversation, ideally zero. No emojis unless the seller uses them first.
3. **Mirror the seller.** Match their message length, formality, and pace. Terse seller gets terse texts. Chatty seller gets a warmer register.
4. **Never admit to being an AI — and never deny it.** If asked directly ("are you a bot?", "is this AI?"), do not lie. Respond by moving to the human: *"ha, it's automated texting on our side but David's the one who actually buys — want me to have him call you?"* and trigger a `callback_requested` escalation. Lying about being human is a trust, ethics, and (increasingly) legal problem; denying is prohibited in the prompt with a hard rule.
5. **Disclose company identity.** First-touch messages always include the business name and opt-out language (10DLC requirement, appended by the SMS manager — the model is told this happens so it doesn't duplicate it). If asked "who is this," always answer with name + company.
6. **Never negotiate price, never make an offer.** The agent can discuss *their* asking price and ballpark ranges only as "David would need to see it / run numbers." Offers come from the human.
7. **State-specific guardrails injected per market:** MD pre-foreclosure leads get the PHIFA block (no rescue framing — see `03-compliance.md` §9); FL/MD 3-per-24h context so the model doesn't propose "I'll text you again tonight."
8. **No pressure, no false urgency, no claims** ("cash in 7 days guaranteed"). Prohibited-phrase list enforced both in prompt and by the deterministic content lint in the compliance gate (defense in depth).

### 2.2 Objection-handling patterns (in-prompt few-shots)

| Seller says | Pattern |
|---|---|
| "Not interested" | One graceful out + door-open: *"all good, thanks for letting me know. if anything changes with the house on Maple, I'm easy to reach."* → status `nurture`, long-cycle cadence. Never argue, never "are you sure?" |
| "How much are you offering?" | Don't dodge twice. First: flip to their number — *"depends on condition honestly. what would you need to walk away?"* If pressed again: give an honest frame — *"for that area, as-is, usually somewhere in the $X–Y range, but David runs real numbers before any offer"* (range comes from underwriting's MAO band injected into context). |
| "That's a lowball / you people are vultures" | Validate + honesty: *"fair — we're investors, so we buy under retail in exchange for as-is, cash, no fees, your timeline. if listing gets you more and you have the time, that's genuinely the better move."* Honesty here converts better than spin and is a compliance asset. |
| "It's already listed / I have an agent" | Disengage cleanly (agent-represented sellers are out of scope): *"got it — good luck with the sale. if the listing expires and you still want a cash option, reach out."* → `dead` with re-check timer at 120 days. |
| "STOP" / any opt-out intent | Model never handles this — the deterministic keyword scan already suppressed and confirmed before Claude runs. If Claude's extraction detects *soft* opt-out intent ("please leave me alone") without a keyword, it must output `intent: opt_out` → same suppression path. |

### 2.3 Qualification goals

The agent works toward filling six fields — conversationally, never as a survey (max one ask per message, spread over the thread):

1. **Motivation** — why sell (inherited, tired landlord, divorce, relocation, condition, arrears)
2. **Timeline** — how soon (the single strongest deal signal)
3. **Price** — their number, or reaction to a range
4. **Condition** — roof/HVAC/kitchen/bath vintage, "needs work" specifics
5. **Occupancy** — owner/tenant/vacant, lease status
6. **Mortgage** — owed balance / behind on payments (approached delicately, late in rapport)

### 2.4 Escalation criteria (→ Notification Agent → David)

Escalate to **hot** when any of:
- Asking price given **and** timeline < 90 days
- Explicit interest in receiving an offer ("what would you give me")
- Callback requested (or bot-question handoff per rule 4)

Escalate to **warm** when: motivation + (timeline or price) captured with cooperative tone. Escalation is computed **deterministically in code from the extraction output** — the model reports fields; TypeScript applies the criteria. Never let the model decide who wakes David up: models are generous, criteria are cheap to test.

## 3. Structured outputs & why extraction runs on every inbound

### Mechanics

Extraction uses Claude tool-use / structured output with a strict JSON schema (`packages/ai/src/schemas/qualification.ts`):

```json
{
  "intent": "positive | neutral | negative | opt_out | wrong_number | agent_represented | question",
  "motivation": {"value": "...", "confidence": 0.0},
  "timeline_days": {"value": 60, "confidence": 0.0},
  "asking_price": {"value": 145000, "confidence": 0.0},
  "condition": {"value": "...", "confidence": 0.0},
  "occupancy": {"value": "tenant", "confidence": 0.0},
  "mortgage_status": {"value": "...", "confidence": 0.0},
  "callback_requested": false,
  "bot_question_asked": false,
  "notable_quotes": ["..."]
}
```

Fields merge into `qualifications` monotonically: a new value overwrites only at ≥ existing confidence, everything versioned for audit. The reply-drafting call is separate from the extraction call — one creative, one strict — because mixing "be human" and "emit strict JSON" in one completion degrades both.

### Why every message, not just "important" ones

1. **Signals hide in throwaway lines.** "Can't talk, at my mom's estate sale" contains motivation + occupancy hints. A gating heuristic ("only extract when it looks substantive") is itself an NLU judgment — you'd need a model to decide whether to run the model.
2. **Escalation must never be missed.** Warm/hot detection is downstream of extraction; skipping any message risks missing the one where the price gets named. A missed hot lead costs $10–15k; the extraction call costs ~$0.01 (2k in / 300 out on Opus ≈ $0.0175, less on Haiku).
3. **Opt-out safety net.** Soft revocations without keywords are caught by `intent: opt_out` — a compliance function, mandatory on 100% of inbound.
4. **The dataset is the moat.** Every extraction becomes labeled outcome data for the post-90-day ML re-ranking work (`08-roadmap.md`). Sparse extraction = sparse training data.
5. **Statuses stay honest.** Pipeline Manager transitions (`conversing → warm`, `→ dead`, `→ suppressed`) are driven by extraction output; per-message extraction keeps the funnel state real-time for the dashboard and for David's context when he takes over a thread.

## 4. Model assignment & tuning

| Agent | Env var | Default | Downgrade path |
|---|---|---|---|
| Conversation | `AI_MODEL_CONVERSATION` | `claude-opus-4-8` | `claude-sonnet-5` after A/B on reply→warm conversion (not on "sounds fine") |
| Extraction | `AI_MODEL_EXTRACTION` | `claude-opus-4-8` | `claude-haiku-4-5` is usually sufficient for schema extraction — test field-level F1 vs Opus on 200 labeled messages |
| Scoring assist | `AI_MODEL_SCORING` | `claude-opus-4-8` | Set to `claude-haiku-4-5` + Batches API from day 1 (see `05-costs.md`) |
| Deal summary | `AI_MODEL_SUMMARY` | `claude-opus-4-8` | Keep Opus — it writes the notification David trades on; volume is tiny |

Prompt changes are versioned (prompt hash stored on each `messages` row) so conversion metrics in `kpi_daily` can be attributed to prompt versions.
