# DealEngine — Monthly Cost Model

> **All vendor prices are estimates from public sources (July 2026) — verify at signup and re-run this model quarterly.** Internal drivers (reply rates, tokens/turn) are assumptions to be replaced with measured values from `kpi_daily` after Month 1.

## 1. The three scales

| Driver | **Starter** | **Growth** | **Scale** |
|---|---|---|---|
| Markets live | 2 | 6 | 12 |
| New records ingested /mo | 5,000 | 25,000 | 80,000 |
| Skip traces /mo | 2,500 | 12,000 | 40,000 |
| Outbound SMS /mo | 10,000 | 60,000 | 200,000 |
| Leads contacted /mo (first-touch) | ~2,000 | ~10,000 | ~30,000 |
| AI voice minutes /mo | 0 | ~2,000 | ~6,000 |
| Direct mail pieces /mo | 0–500 | ~3,000 | ~10,000 |

## 2. Line items

### Data & skip trace

| Item | Starter | Growth | Scale | Basis (verify) |
|---|---|---|---|---|
| BatchData property lists | $400 | $1,000 | $2,000 | Published Growth tier $1,000/mo per 100k records; starter tiers negotiable below that |
| ATTOM (detail/comps/AVM) | $500 | $1,000 | $2,000 | No public rates; entry packages reported ~$500/mo, custom quote |
| BatchData skip tracing | $350 | $1,400 | $2,000 | Published floor $2,000/mo per 100k traces; small-volume per-hit deals ~$0.10–0.20/trace |
| IDI/Enformion waterfall (2nd pass, ~25% of traces) | — | $600 | $1,800 | ~$0.50–2.00/record pay-as-you-go; assume ~$1 avg |
| **Subtotal** | **$1,250** | **$4,000** | **$7,800** | |

### Messaging & voice

| Item | Starter | Growth | Scale | Basis (verify) |
|---|---|---|---|---|
| Twilio SMS out (incl. ~$0.003 carrier fee, ~1.1 seg avg) | $120 | $730 | $2,420 | ~$0.011/segment effective |
| Twilio SMS in (~20% reply volume) | $20 | $130 | $440 | ~$0.0079/segment |
| Numbers + 10DLC monthly | $20 | $60 | $130 | ~$1.15/number/mo; ~$2–10 campaign fee/mo |
| SendGrid | $20 | $90 | $90 | Essentials $19.95 / Pro $89.95 |
| Retell AI voice (all-in ~$0.20/min) | — | $400 | $1,200 | Base $0.07/min; realistic $0.13–0.31/min with LLM+telephony |
| Drop Cowboy RVM (consented only, small volume) | — | $30 | $100 | ~$0.004/drop BYOC + $0.0031 compliance fee, or plan pricing |
| **Subtotal** | **$180** | **$1,440** | **$4,380** | |

### Direct mail

| Item | Starter | Growth | Scale | Basis (verify) |
|---|---|---|---|---|
| Lob postcards | $240 (500) | $1,440 (3,000) | $4,800 (10,000) | ~$0.48/postcard print+post |
| Lob platform plan | — | $550 | $550 | Growth plan ~$550/mo; negotiate at volume |
| Handwrytten (top-decile leads) | — | $400 (~100 notes) | $1,000 (~250) | ~$3.25–5/note + postage |
| **Subtotal** | **$240** | **$2,390** | **$6,350** | |

### Claude API

Assumptions: **~2k input / 300 output tokens per conversation turn** (system prompt + thread context + extraction pass), **~50 turns per 100 leads contacted**; nightly bulk scoring assist ~800 in / 100 out per new record on Haiku 4.5 via **Batches API (−50%)**; deal summaries negligible.

| Item | Starter | Growth | Scale | Math |
|---|---|---|---|---|
| Conversation + extraction (Opus 4.8, $5/$25 per 1M) | $18 | $88 | $263 | turns = leads×0.5 → tokens×rates (e.g. Growth: 5,000 turns → 10M in=$50 + 1.5M out=$37.50) |
| Nightly batch scoring (Haiku 4.5 batched, $0.50/$2.50 per 1M eff.) | $3 | $14 | $42 | records × 800/100 tokens × half-price |
| Headroom (retries, summaries, long threads) ×1.5 | $10 | $50 | $150 | buffer |
| **Subtotal** | **~$30** | **~$150** | **~$455** | |

> Cost lever: `AI_MODEL_CONVERSATION=claude-sonnet-5` cuts conversation cost ~40% ($3/$15; intro $2/$10 through **2026-08-31**). Test reply quality before switching — conversation quality is the whole funnel. Scoring on Haiku is a free win; do it from day 1.

### Infra & misc

| Item | Starter | Growth | Scale | Basis |
|---|---|---|---|---|
| Hosting (VPS → GCP) | $50 | $300 | $600 | Hetzner box → Cloud Run + Cloud SQL + Memorystore |
| Temporal Cloud | — (self-host) | $100 | $200 | Estimate — verify current namespace pricing |
| Sentry, uptime, tunnels | $30 | $60 | $80 | |
| Litigator scrub service | $100 | $200 | $300 | Estimate — e.g. Blacklist Alliance tier |
| TX registration amortized + compliance/legal retainer | $100 | $250 | $400 | TX: ~$200/location + $10k deposit (one-time, refundable-ish); attorney reviews |
| **Subtotal** | **$280** | **$910** | **$1,580** | |

## 3. Totals

| | **Starter** | **Growth** | **Scale** |
|---|---|---|---|
| Data & skip trace | $1,250 | $4,000 | $7,800 |
| Messaging & voice | $180 | $1,440 | $4,380 |
| Direct mail | $240 | $2,390 | $6,350 |
| Claude API | $30 | $150 | $455 |
| Infra & misc | $280 | $910 | $1,580 |
| **Total /mo (est.)** | **~$1,980** | **~$8,890** | **~$20,565** |

Note the shape: **data + mail dominate; AI is a rounding error.** Claude is ~1.5–2% of spend at every scale. Optimize list quality and mail targeting before optimizing model choice.

## 4. Per-deal economics

Benchmarks (industry ranges for cold SMS-led wholesaling — replace with measured values):

| Funnel stage | Rate (est. range) | Growth-tier /mo |
|---|---|---|
| Leads contacted | — | 10,000 |
| Any reply | 8–15% | ~1,000 |
| Positive/qualifying conversation | 2–4% of contacted | ~300 |
| **Warm/hot (escalated to David)** | 1–2% of contacted | ~150 |
| Appointments/offers | 0.3–0.6% | ~45 |
| Contracts | 0.10–0.20% | ~15 |
| **Closed deals** | **0.05–0.10% (5–10 per 10k contacted)** | **5–10** |

| Metric | Starter | Growth | Scale |
|---|---|---|---|
| Est. deals /mo | 1–2 | 5–10 | 15–30 |
| Cost per lead contacted | ~$0.99 | ~$0.89 | ~$0.69 |
| Cost per warm lead | ~$66 | ~$59 | ~$46 |
| **Cost per deal** | ~$1,000–2,000 | ~$900–1,800 | ~$700–1,400 |
| Revenue per deal (typical wholesale assignment fee) | **$10,000–15,000** | same | same |
| **Est. gross margin /mo** | $8k–28k | $41k–141k | $130k–430k |

Even at the pessimistic edge (1 deal/2,000 contacted, $10k fee), the model clears ~5× on marketing cost. The binding constraint at Scale is not spend — it is **David's closing bandwidth** (~15–30 warm negotiations/mo is a full-time job; see roadmap for the disposition-module implication).

## 5. Budget controls (built)

- Per-vendor monthly budget caps in workers (Redis counters); activities fail-fast at 100%, Slack alert at 80%.
- `kpi_daily` tracks measured cost-per-reply and cost-per-warm by market — kill or shrink markets below the median monthly.
- Batches API for anything non-interactive; per-agent model env vars for instant downgrades.
- The `SMS_WEEKLY_CAP` and compliance caps double as spend governors.
