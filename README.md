# DealEngine — AI Acquisitions Platform

Production platform for sourcing off-market residential deals across 12 markets
(OH, TX, FL, GA, TN, IN, MD). It finds motivated sellers daily, skip traces
them, scores them, runs compliant multi-channel outreach, holds natural AI
conversations until a seller is genuinely interested, underwrites the deal, and
then hands you a full negotiation brief. **You only talk to warm sellers.**

> ⚠️ **Before any outbound goes live**: read [docs/03-compliance.md](docs/03-compliance.md)
> and have your process reviewed by a TCPA attorney. The compliance engine
> enforces quiet hours, opt-outs, caps, and consent gates — but registration
> steps (10DLC, state solicitation registrations) and legal review are on you.

## What's here

| Path | What it is |
|---|---|
| `db/migrations/` | PostgreSQL schema — properties, leads, conversations, compliance, underwriting, KPIs |
| `packages/shared` | Types, config, DB pool, logging, address/phone normalization |
| `packages/compliance` | The outbound gate: per-state quiet hours, suppression, consent, frequency caps, audit |
| `packages/scoring` | Explainable 0–100 lead score + conversation-driven temperature |
| `packages/underwriting` | ARV (weighted comps + AVM), repair estimator, MAO/deal analyzer (wholesale/flip/BRRRR) |
| `packages/ai` | Claude conversation engine, qualification extraction, deal-summary generator |
| `packages/integrations` | Twilio, SendGrid, Retell, Drop Cowboy, Lob, Handwrytten, BatchData, ATTOM, Slack, GoHighLevel |
| `packages/core` | Pipeline services: ingest/dedupe, enrich, skip trace, score, underwrite, inbound/outbound, notify, KPIs |
| `services/api` | Fastify: provider webhooks + dashboard REST API (port 4000) |
| `services/workers` | Temporal workflows: daily pipeline per market, durable per-lead outreach cadence |
| `apps/dashboard` | Next.js operator dashboard (port 3000) |
| `docs/` | Architecture, vendor stack, compliance playbook, deployment, costs, agents, scaling, roadmap |

## The daily loop

```
06:00 market-local  Temporal schedule fires per market
  → pull distressed records (BatchData quicklists)
  → normalize, dedupe, list-stack           (Data Cleaning Agent)
  → ATTOM enrichment                        (Property Intelligence Agent)
  → skip trace                              (Skip Trace Agent)
  → score 0–100, explainable                (Lead Scoring Agent)
  → start durable outreach workflows        (Follow-Up Manager)
      day 0 SMS → day 2 SMS → day 4 email → day 7 RVM* → day 10 SMS
      → day 14 postcard → day 21 AI voice* → day 28 SMS → day 42 handwritten
      → quarterly nurture             (*consent-gated channels)

Seller replies → Twilio webhook → compliance/opt-out check → Claude turn
  (reply + intent + qualification extraction + escalation, one structured call)
  → cadence pauses automatically → conversation continues until…

Seller is WARM/HOT → underwrite (comps, ARV, repairs, MAO)
  → Claude writes the negotiation brief
  → you get SMS + email + Slack + dashboard notification
  → YOU close. Everything before that was automatic.
```

## Quick start (dev)

Prerequisites: **Node 20+**, **Docker Desktop**. Full walkthrough with every
credential explained: [docs/04-deployment.md](docs/04-deployment.md).

```bash
cd platform
copy .env.example .env        # fill in at minimum DATABASE_URL + ANTHROPIC_API_KEY
docker compose up -d postgres redis temporal temporal-ui
npm install
npm run migrate
npm run seed                  # 12 markets, sources, default campaign
npm run build
npm run dev:api               # terminal 1
npm run dev:workers           # terminal 2
npm run dev:dashboard         # terminal 3 → http://localhost:3000
npm run schedules -w @dealengine/workers   # create daily Temporal schedules
```

Expose webhooks during dev (`ngrok http 4000`), then point Twilio's inbound SMS
webhook at `https://<tunnel>/webhooks/twilio/inbound` and set `APP_BASE_URL`
accordingly (signature validation depends on it).

**Kill switch:** set `OUTBOUND_ENABLED=false` in `.env` to instantly stop all
outbound while keeping ingestion and inbound processing alive.

## Safety-by-design decisions worth knowing

- **Every** outbound touch passes `checkOutbound()` — quiet hours in the
  *recipient's* timezone, per-state caps (FL 3-per-24h), suppression list,
  consent gates for RVM/AI-voice, MD pre-foreclosure mail-first policy. Every
  evaluation (allowed or blocked) is written to `outbound_compliance_log`.
- The AI **never quotes prices or makes offers** — it qualifies and schedules;
  you negotiate. It also never claims to be human when asked directly.
- Opt-out processing runs **before** the AI sees any inbound message, cancels
  all pending touches on every channel, and suppresses the contact globally.
- Human takeover: one toggle in the dashboard silences the AI on that lead and
  signals the outreach workflow to stop.
- Postgres is the system of record. GoHighLevel sync is optional and one-way.

## Docs

1. [Architecture](docs/01-architecture.md) — diagrams, services, why Temporal
2. [Data & vendor stack](docs/02-data-and-vendor-stack.md) — what to buy, verified pricing, phased plan
3. [Compliance playbook](docs/03-compliance.md) — TCPA + all 8 states, engine mapping ⚠️ read first
4. [Deployment](docs/04-deployment.md) — dev install, GCP production, DR runbook
5. [Costs](docs/05-costs.md) — monthly model at 3 scales, per-deal economics
6. [Agents](docs/06-agents.md) — the full agent roster + prompt engineering guide
7. [Scaling & security](docs/07-scaling-security.md)
8. [Roadmap](docs/08-roadmap.md) — 90-day launch plan
