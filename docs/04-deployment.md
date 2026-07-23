# DealEngine — Deployment Guide

Covers: (a) local/dev on Windows, (b) production on GCP with a budget VPS alternative, (c) monitoring/logging, (d) disaster recovery.

## A. Local development (Windows)

### A.1 Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | **20.x LTS** | `winget install OpenJS.NodeJS.LTS` — verify `node -v` → v20.x. Workspaces need npm ≥ 10 (bundled). |
| Docker Desktop | current | WSL2 backend enabled. Allocate ≥ 6 GB RAM in Docker settings (Temporal + Postgres are hungry). |
| Git | current | `winget install Git.Git` |
| ngrok **or** cloudflared | current | For exposing webhooks to Twilio/SendGrid/Retell during dev. |

### A.2 Clone & install

```powershell
git clone <repo-url> dealengine
cd dealengine
npm install          # installs all workspaces (packages/*, services/*, apps/*)
```

### A.3 Environment configuration

```powershell
Copy-Item .env.example .env
```

Fill `.env` — per-credential instructions:

| Variable | Where to get it |
|---|---|
| `DATABASE_URL` | Local compose default: `postgres://dealengine:dealengine@localhost:5432/dealengine` — matches `docker-compose.yml`. |
| `REDIS_URL` | `redis://localhost:6379` |
| `TEMPORAL_ADDRESS` | `localhost:7233` (compose) |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys. |
| `AI_MODEL_CONVERSATION` / `AI_MODEL_EXTRACTION` / `AI_MODEL_SCORING` / `AI_MODEL_SUMMARY` | Default `claude-opus-4-8`. Set `AI_MODEL_SCORING=claude-haiku-4-5` to cut cost immediately. |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Twilio Console dashboard. Auth token doubles as webhook signature secret. |
| `TWILIO_MESSAGING_SERVICE_SID` | Create a Messaging Service, attach your 10DLC campaign + numbers, copy the `MG...` SID. |
| `SENDGRID_API_KEY` | SendGrid → Settings → API Keys (Full Access for dev; restricted in prod). |
| `RETELL_API_KEY` | Retell dashboard (Phase 2 — can leave blank; adapter degrades gracefully). |
| `DROPCOWBOY_TEAM_ID` / `DROPCOWBOY_SECRET` | Drop Cowboy → API settings (Phase 2, off by default). |
| `LOB_API_KEY` | Lob dashboard — use the **test** key locally (test keys don't print/charge). |
| `HANDWRYTTEN_API_KEY` | Handwrytten business account (Phase 2). |
| `BATCHDATA_API_KEY` | BatchData developer portal after contract. |
| `ATTOM_API_KEY` | api.developer.attomdata.com — trial key works for dev. |
| `SLACK_WEBHOOK_URL` | Slack → Apps → Incoming Webhooks → your alerts channel. |
| `OWNER_PHONE` / `OWNER_EMAIL` | David's cell + email for warm/hot notifications. |
| `OUTBOUND_ENABLED` | **`false` in dev, always.** Nothing leaves the machine until this is `true`. |
| `SMS_WEEKLY_CAP` | Start at `3`. |
| `DNC_SCRUB_KEY` | Optional; when unset, imports must be pre-scrubbed (see 03-compliance.md §3). |
| `API_KEY_DASHBOARD` | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `GHL_API_KEY` | Optional GoHighLevel one-way sync; leave blank to disable. |

### A.4 Start infrastructure + migrate + seed

```powershell
docker compose up -d postgres redis temporal temporal-ui
npm run migrate        # applies db/migrations to Postgres 16
npm run seed           # 12 markets, state compliance profiles, demo leads
```

Temporal UI: http://localhost:8080 — confirm the `default` namespace is up before starting workers.

### A.5 Run the services

Three terminals (or `npm run dev` if the root script runs all three concurrently):

```powershell
npm run dev -w services/api        # Fastify on :4000
npm run dev -w services/workers    # Temporal workers
npm run dev -w apps/dashboard      # Next.js on :3000
```

Smoke test: `curl http://localhost:4000/health`, open http://localhost:3000, confirm seeded leads render, and check Temporal UI shows worker pollers on the task queues.

### A.6 Webhooks (Twilio → your laptop)

```powershell
ngrok http 4000
# or: cloudflared tunnel --url http://localhost:4000
```

Copy the public HTTPS URL, then configure:

- **Twilio:** Messaging Service → Integration → Incoming message webhook → `https://<tunnel>/webhooks/twilio/sms` (HTTP POST). Also set status callback → `/webhooks/twilio/status`.
- **SendGrid:** Settings → Mail Settings → Event Webhook → `https://<tunnel>/webhooks/sendgrid/events`.
- **Retell:** agent webhook → `https://<tunnel>/webhooks/retell/events`.

Note: signature verification uses the *exact public URL* Twilio called — the api reads `WEBHOOK_BASE_URL` from `.env`; update it every time the ngrok URL rotates (or reserve a static ngrok domain).

Send a text to your Twilio number → watch it appear in `messages`, the inbound workflow fire in Temporal UI, and (with `OUTBOUND_ENABLED=false`) the reply logged as **blocked** in `outbound_compliance_log`. That blocked row is the correct dev behavior.

## B. Production

### B.1 Reference: GCP

| Component | GCP service | Sizing (start) | Notes |
|---|---|---|---|
| api | Cloud Run | 1 vCPU / 512 MB, min instances 1, max 10 | Min 1 so webhooks never cold-start; Twilio times out at 15s. |
| workers | Cloud Run (always-on) | 1 vCPU / 1 GB, min 1, max 5 | **CPU always allocated** (not request-based) — Temporal pollers need continuous CPU. |
| dashboard | Cloud Run | 1 vCPU / 512 MB, min 0 | Solo operator; cold starts fine. |
| Postgres | Cloud SQL Postgres 16 | db-custom-2-8192, 50 GB SSD | **Automated daily backups + PITR (WAL) enabled** — non-negotiable, this is the CRM. Private IP + Cloud SQL connector. |
| Redis | Memorystore | 1 GB basic | Cache/rate-budget counters only; safe to lose. |
| Temporal | **Temporal Cloud** | smallest namespace | ~$50–200/mo (estimate — verify); running self-hosted Temporal on Cloud Run is not supported — if avoiding Temporal Cloud, run Temporal on a GCE VM. |
| Secrets | Secret Manager | — | All `.env` values; Cloud Run mounts them. No secrets in images or repo. |
| Edge | Cloud Armor + HTTPS LB in front of api | — | Rate-limit webhook routes; allowlist dashboard by IP if practical. |
| Registry/CI | Artifact Registry + Cloud Build (or GH Actions) | — | Build once, deploy per service with `--set-secrets`. |

Deploy order: Cloud SQL → run migrations from CI → Temporal Cloud namespace + mTLS certs into Secret Manager → workers → api → dashboard → point Twilio/SendGrid/Retell webhooks at the api's stable URL → flip `OUTBOUND_ENABLED` only after the compliance checklist in `03-compliance.md` §11 passes.

Estimated GCP cost: **$150–400/mo** at Starter/Growth scale (estimate — verify against your usage; see `05-costs.md`).

### B.2 Budget alternative: single VPS

One Hetzner CPX41 (~$30/mo est.) or EC2 t3.xlarge running the same `docker-compose.prod.yml` (adds Caddy for TLS):

- Everything on one box: postgres, redis, temporal, temporal-ui (bound to localhost + SSH tunnel only), api, workers, dashboard, Caddy.
- **Backups leave the box:** nightly `pg_dump` to S3/B2 with 30-day retention + weekly base backup; test restores monthly (see D).
- Firewall: 80/443 open; 5432/6379/7233/8080 bound to localhost only.
- This is a fine way to run Months 1–3. Migrate to GCP when: SMS > 100k/mo, or a single-box failure would cost you an active negotiation window.

## C. Monitoring & logging

| Concern | Tool | Setup |
|---|---|---|
| App logs | pino (JSON) from `packages/shared` | Cloud Run → Cloud Logging automatically; VPS → `docker logs` + Loki or Vector→S3. Every log line carries `leadId`/`workflowId` correlation fields. |
| Errors | Sentry | `SENTRY_DSN` in all three services; alert on new issue + error-rate spike. |
| Workflow health | Temporal UI / Cloud web console | Watch: failed workflows, stuck activities, schedule-to-start latency (worker starvation signal). |
| Uptime | GCP Uptime Checks or UptimeRobot/healthchecks.io | Probe `api/health` (checks DB + Temporal + Redis connectivity) every 60s → Slack. |
| Business KPIs | dashboard `kpi_daily` | Daily 8am Slack digest from Notification Agent: new leads, sends, replies, warm/hot, blocked-send count. |
| Compliance | dashboard compliance panel | Alert if: opt-out latency > 1 min, blocked-send spike, `OUTBOUND_ENABLED` flipped. |
| Spend | vendor dashboards + our per-vendor call counters (Redis) | Hard budget stops in workers per `05-costs.md`; alert at 80% of monthly budget. |

## D. Disaster recovery

### Targets

| Metric | Target | Rationale |
|---|---|---|
| RPO | ≤ 5 min (GCP, PITR) / ≤ 24 h (VPS nightly dump) | Losing a day of conversation history is survivable but painful; losing consent/opt-out records is a compliance problem — hence PITR in prod. |
| RTO | ≤ 4 h | Sellers tolerate a quiet afternoon; active negotiations are with David directly by then anyway. |

### Backup schedule

- **Postgres:** GCP — automated daily backups + WAL PITR, 14-day window; plus weekly logical `pg_dump` to a separate GCS bucket (cross-region, versioned) for corruption/tooling independence. VPS — nightly `pg_dump` to offsite object storage, 30-day retention.
- **Temporal:** Temporal Cloud is managed; self-hosted — its Postgres DB is in the same backup regime. Workflows are re-creatable: a recovery script re-launches `leadOutreach` for every lead in `in_outreach` from `leads` + `messages` state.
- **Secrets:** Secret Manager is durable; keep an encrypted offline copy (e.g., in a password manager) of all vendor credentials.
- **Restore runbook (quarterly drill):**
  1. Provision fresh Postgres; restore latest backup (`gcloud sql backups restore` or `pg_restore`).
  2. `npm run migrate` (no-op if current) → integrity check script (`npm run db:verify`: row counts, FK sanity, latest `outbound_compliance_log` timestamp).
  3. Point services at restored DB via Secret Manager update + redeploy.
  4. **Keep `OUTBOUND_ENABLED=false`** until the re-launch script reconciles cadence state — otherwise restored leads can double-send.
  5. Run cadence-reconciliation script; spot-check 10 leads in Temporal UI; re-enable outbound.

### Vendor-outage degradation modes

| Vendor down | Behavior (built) |
|---|---|
| Twilio | Outbound SMS activities retry with backoff, then park cadence step (Temporal timer); inbound is lost only if Twilio itself is down (they retry webhooks). No failover SMS vendor in v1 — accepted risk. |
| Anthropic | Conversation replies queue; if > 15 min, Notification Agent pings David to take over threads manually via dashboard. Extraction backfills when service returns. Nightly batch scoring simply runs the next night. |
| BatchData/ATTOM | `dailyPipeline` marks the pull failed and retries next cycle; no data loss, just a slow day. |
| Temporal | api still ingests webhooks to Postgres (source of truth); workflows resume when Temporal returns — this is the core reason for the "persist first, then signal" webhook design. |
| Postgres | Full stop by design. Nothing sends without the compliance gate, and the gate needs the DB. This is intentional: fail closed. |
