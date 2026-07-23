# DealEngine — Scaling & Security

## Part 1 — Scaling

### 1.1 Database at 1M+ leads

At 12 markets × 80k records/mo, `leads` passes 1M rows within a year and `messages` / `outbound_compliance_log` grow ~10× faster.

**Indexes (in migrations; the load-bearing set):**

| Table | Index | Serves |
|---|---|---|
| `leads` | `(market_id, status)` partial per hot statuses | dashboard pipeline board, cadence pickup |
| `leads` | `(score DESC) WHERE status = 'scored'` | outreach prioritization |
| `properties` | `UNIQUE (county_fips, apn)` | dedupe — the most-hit index in ingestion |
| `contacts` | `(phone_e164)` | inbound webhook → lead resolution (must be ms-fast; Twilio waits) |
| `messages` | `(lead_id, created_at DESC)` | conversation context rebuild for Claude |
| `messages` | `UNIQUE (vendor, vendor_sid)` | webhook idempotency |
| `suppressions` | `(phone_e164)`, `(email)` | compliance gate hot path |
| `outbound_compliance_log` | `(lead_id, created_at)` | audits; BRIN on `created_at` for range scans |

**Partitioning:** `messages` and `outbound_compliance_log` are declaratively **range-partitioned by month** on `created_at` from the start (cheap now, painful to retrofit). `leads` is *not* partitioned — 1–5M rows is comfortable for well-indexed Postgres 16; revisit at 10M. Old message partitions (> 24 months) detach to cold storage, except compliance log partitions which are retained ≥ 4 years (`03-compliance.md` §11).

**Other:** `kpi_daily` exists precisely so the dashboard never aggregates raw tables; conversation context rebuilds cap at the last N=40 messages; autovacuum tuned aggressively on `leads` (high update churn from status transitions).

### 1.2 Temporal worker scaling

- One worker deployment, two task queues: `pipeline` (bulk, throughput-oriented) and `interactive` (inbound processing + conversation replies, latency-oriented). This prevents a nightly ingest from starving a seller waiting on a reply.
- **The scaling signal is schedule-to-start latency** per task queue (Temporal metric). Alert > 5s on `interactive`, > 5 min on `pipeline`; autoscale workers (Cloud Run instance count) on it.
- Activity concurrency limits per vendor are set at the worker level (`maxConcurrentActivityExecutions` per activity type) so scaling workers out doesn't multiply vendor pressure — the rate budget (below) is the global cap.
- `dailyPipeline` staggers markets across the night (per-market cron offsets) so 12 markets don't stampede BatchData/ATTOM at midnight.

### 1.3 Vendor rate-limit budgeting

Central budget table (config) consumed via Redis token buckets, enforced inside each integration adapter:

| Vendor | Budget dimension | Behavior at limit |
|---|---|---|
| Twilio | msgs/sec per number + carrier daily caps per 10DLC trust score | queue and smooth (send-window shaping), never burst |
| BatchData / ATTOM | req/sec + monthly $ cap | backoff; monthly cap → fail-fast + Slack (see `05-costs.md` §5) |
| Anthropic | tokens/min + req/min tier limits | interactive: retry w/ jitter; bulk: shift to Batches API |
| Retell | concurrent calls | cap concurrency at plan limit |
| Lob/Handwrytten | daily piece budget | spillover to next day |

Budgets live in one module (`packages/integrations/src/rate-budget.ts`) so raising a Twilio number's throughput after trust-score upgrade is a config change, not a hunt.

### 1.4 Backpressure

The system is pull-based end-to-end: cadence steps and pipeline activities *take* work as capacity allows (Temporal task queues are the buffer). Rules:

- Inbound webhooks never block on downstream: persist → ack → signal (see architecture §7). Twilio's retry policy is the only upstream buffer we need.
- If `interactive` queue depth grows (Anthropic slow), replies delay gracefully; the seller experience degrades from "2 min" to "20 min" — acceptable. Alert at 15 min (`04-deployment.md` D).
- Nightly scoring backlog simply rolls over; scoring freshness is monitored, not guaranteed.
- Compliance gate is synchronous and fail-closed — under any doubt (DB unreachable, config stale) the answer is "blocked."

### 1.5 Multi-region notes

Not needed at this scale (single-operator, US-only, minutes-of-downtime tolerance). What we do carry: all timestamps UTC with per-market timezone applied only at the compliance/display edge; region-pinned everything in `us-east` (nearest to most markets + David); cross-region backup copies (`04-deployment.md` D). True multi-region active-active would require Temporal namespace strategy and is explicitly out of scope pre-$10M.

## Part 2 — Security

### 2.1 Secret management

- Prod: GCP Secret Manager, mounted into Cloud Run; VPS: `.env` root-owned `0600`, never in git (`.env*` gitignored; `.env.example` has placeholders only).
- Rotation: quarterly for vendor keys, immediately on any suspicion; Twilio auth token and `API_KEY_DASHBOARD` support dual-active rotation.
- CI has its own scoped credentials (migrate-only DB role); no prod secrets on developer laptops beyond dev-tier vendor keys.

### 2.2 Webhook signature verification (mandatory, all webhooks)

- **Twilio:** `X-Twilio-Signature` HMAC-SHA1 over the exact public URL + sorted POST params, keyed by the auth token. Verified in a Fastify preHandler before any parsing; failures → 403 + Sentry. Gotcha: the URL must be the *public* URL (ngrok/prod domain), hence `WEBHOOK_BASE_URL` config.
- **SendGrid:** Event Webhook ECDSA signature (`X-Twilio-Email-Event-Webhook-Signature`) with the verification key.
- **Retell:** webhook signing secret per their scheme.
- All handlers idempotent on vendor SID (unique index) — replayed/duplicated webhooks are no-ops.

### 2.3 API authentication

- Dashboard → api: static API key (`API_KEY_DASHBOARD`) in `Authorization: Bearer`, checked by middleware on all non-webhook, non-health routes; dashboard keeps it server-side (Next.js route handlers proxy — the key never reaches the browser).
- Single-operator posture: no user model in v1. If a VA/partner is added, that is the trigger to introduce real sessions + roles — flagged in roadmap.
- Network layer: Cloud Armor rate limits on webhook paths; dashboard optionally IP-allowlisted or behind Cloud IAP.

### 2.4 Least-privilege DB roles

| Role | Grants | Used by |
|---|---|---|
| `de_migrate` | DDL | CI migrations only |
| `de_app` | DML on app tables; **no DDL, no DELETE on `outbound_compliance_log`/`consent_events`** (append-only enforced at grant level + trigger) | api, workers |
| `de_readonly` | SELECT | dashboards/analytics, ad-hoc queries |
| `de_backup` | replication/read | backup tooling |

No superuser in any connection string. `pgcrypto` available for column encryption (below).

### 2.5 PII handling — skip-trace data is sensitive

Skip-traced phones/emails/name-linkage are regulated-adjacent data (vendor terms invoke GLBA/DPPA permissible-purpose obligations) and a real breach-harm vector.

- **Encryption at rest:** Cloud SQL/managed disks encrypt by default; additionally, `contacts.phone_e164`, `contacts.email`, and raw skip-trace payloads (`contacts.raw_response`) are column-encrypted (pgcrypto, key in Secret Manager). Lookup uses a keyed hash column (`phone_hash`) so the inbound hot path stays indexed without plaintext.
- **Minimization:** we store only fields we use (phones, emails, type, confidence). Full skip-trace payloads (relatives, associates, address history) are **not** retained beyond the raw blob, and that blob is purged at 90 days.
- **Retention policy:** contacts for `dead`/`closed_lost` leads with no activity for 24 months → purged to hash-only tombstones. Compliance artifacts (`consent_events`, `outbound_compliance_log`, message *metadata*) are retained ≥ 4 years.
- **Deletion on opt-out:** opt-out does NOT delete — it must persist to honor the suppression forever. Instead: contact record collapses to `phone_hash` + suppression row; plaintext PII and thread content beyond the compliance minimum are scrubbed after 30 days. This satisfies both "stop using my data" and "prove you honored the opt-out."
- **Vendor egress:** PII goes only to vendors performing the contact (Twilio gets the phone it's texting); GHL sync (if on) sends the minimum contact card; Claude prompts contain the seller's first name and property facts — threads, not skip-trace dossiers.
- Logs are PII-scrubbed: pino redact paths for phone/email fields; Sentry `beforeSend` strips message bodies.

### 2.6 SOC2-lite checklist

Not pursuing certification; borrowing the discipline:

- [ ] Secrets in a manager, never in code/images/logs (2.1)
- [ ] MFA on every vendor account (Twilio, GCP, Anthropic, BatchData, bank of record)
- [ ] Unique creds per system; no shared logins
- [ ] Least-privilege DB roles (2.4); prod DB not publicly reachable
- [ ] All webhooks signature-verified (2.2); all traffic TLS
- [ ] Backups automated, offsite, restore-tested quarterly (`04-deployment.md` D)
- [ ] Dependency scanning (`npm audit` in CI + Dependabot); images rebuilt monthly
- [ ] Access review quarterly (it's David — the review is "did I share anything, rotate what I did")
- [ ] Incident runbook: kill switch first (`OUTBOUND_ENABLED=false`), then rotate, then investigate via audit logs
- [ ] Change control: migrations + prompt versions through git; no manual prod DDL

### 2.7 Audit log usage

Three append-only spines answer any "what happened / who knew what when" question:

1. **`outbound_compliance_log`** — every attempted send with gate verdict + rule snapshot. Primary artifact for a TCPA demand letter response: produce, for a given phone number, every attempt, verdict, and the consent/suppression state at that instant.
2. **`consent_events`** — the consent ledger, with evidence blobs. Joined with (1) it demonstrates the gate honored revocation within seconds.
3. **`messages` + status transition history** — reconstructs any seller interaction end-to-end (including which prompt version generated each reply — `06-agents.md` §4).

Operationally: the dashboard compliance panel is a thin view over these; monthly review checklist in `03-compliance.md` §11; any manual DB intervention gets a `manual_actions` note row referencing ticket/reason.
