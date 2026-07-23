# DealEngine — 90-Day Implementation Roadmap

Principle: **ingest early, outreach late.** Data pipelines can run risk-free from day 1; every outbound channel waits for its compliance gate to be provably working. Revenue events (first contract) are lagging indicators — the roadmap manages leading indicators (list quality, reply rate, warm rate) instead.

## Phase 0 → Week 1–2: Foundation

**Goal:** accounts opened, stack running, **Market 1 (Columbus OH) live in ingest-only mode.** `OUTBOUND_ENABLED=false` the entire phase.

| Track | Tasks |
|---|---|
| Accounts | Anthropic key; Twilio account + LLC brand **10DLC registration started day 1** (vetting is the long pole — days to weeks); buy 2 Columbus numbers; BatchData starter contract; ATTOM trial → contract; SendGrid; Slack webhook; Sentry. |
| Legal | Engage TCPA attorney; deliver `03-compliance.md` + draft SMS templates/cadence for review. Decide the **Texas question** (register w/ SoS + $10k deposit vs. TX = mail/other channels) before Month 2. |
| Infra | Compose stack up locally (`04-deployment.md` A); migrations + seed; VPS or GCP project provisioned; CI deploying on merge; backups configured **and restore-tested once** now, not later. |
| Pipeline | `dailyPipeline` live for Columbus: BatchData pull → clean/dedupe → ATTOM enrich → skip trace (small batches) → score. Tune distress-filter buy-box against manual spot checks. |

**Exit criteria**
- [ ] 2,000+ Columbus leads at status `scored`; dedupe rate and skip-trace mobile-hit rate (target ≥ 65%) measured in `kpi_daily`
- [ ] 10DLC campaign **approved** (or escalated with Twilio support)
- [ ] Attorney review of templates/cadence in writing; TX decision made
- [ ] Restore drill passed; Temporal UI shows clean `dailyPipeline` runs 3 days straight
- [ ] Inbound test SMS → blocked-reply row in `outbound_compliance_log` (gate provably closed)

## Week 3–4: Outreach live, small volume

**Goal:** first real conversations in Columbus at deliberately tiny volume; compliance behavior verified against production traffic.

- Flip `OUTBOUND_ENABLED=true` for Columbus only. Volume ramp: 25/day → 50/day → 100/day, top-scored leads first, `SMS_WEEKLY_CAP=2` initially.
- Full `leadOutreach` cadence live: SMS-led; mail step (Lob) optional; **no RVM, no AI voice** (consent-gated channels stay dark).
- Watch daily: delivery rate (>95% or the 10DLC campaign/content needs work), opt-out rate (<3% or templates are off), reply rate, opt-out latency (<1 min), Claude reply quality (David reads **every** thread this fortnight and marks bad replies → prompt iterations, versioned).
- Add Market 2 (Indianapolis) in **ingest-only** to burn in multi-market pipeline behavior.
- First warm/hot escalations → David closes by phone; capture what the notification summary was missing and fix the summary prompt.

**Exit criteria**
- [ ] ≥ 1,500 leads contacted; reply rate ≥ 8%; opt-out ≤ 3%; zero compliance-gate bypass incidents (audit log spot-check)
- [ ] ≥ 10 warm escalations; David confirms escalation precision ≥ 70% ("worth my call")
- [ ] ≥ 1 verbal offer made (contract not required yet)
- [ ] Prompt v2 shipped from thread-review notes; extraction field accuracy spot-checked on 100 messages

## Month 2: Scale channels + AI voice + more markets

**Goal:** 4–6 markets live; the cost model becomes measured, not estimated.

- Markets: + Indianapolis outreach; + Memphis, Toledo, Atlanta ingest→outreach as 10DLC throughput allows (add numbers per market; watch trust-score caps).
- Texas markets go live per the Week-2 legal decision (registered SMS, or mail/inbound-only).
- Channels: Lob postcards standard for high-score/no-mobile leads; Handwrytten for top decile; **Retell AI inbound answering** live (call the postcard's tracked number → AI answers, qualifies, extracts, escalates). Outbound AI voice remains consent-only.
- IDI/Enformion waterfall on, driven by measured BatchData miss rate per market.
- Ops: budget caps + 80% alerts armed per vendor (`05-costs.md` §5); `kpi_daily` cost-per-warm per market on the dashboard; kill/shrink any market below median after 4 full weeks.
- Consider `AI_MODEL_CONVERSATION=claude-sonnet-5` A/B (intro pricing ends 2026-08-31) — judged on reply→warm conversion only.

**Exit criteria**
- [ ] 4–6 markets in outreach; ≥ 8,000 leads contacted/mo run-rate
- [ ] Measured funnel within 2× of `05-costs.md` benchmarks; measured cost-per-warm ≤ $75
- [ ] **First contract signed** (`under_contract`), target 2–4
- [ ] Retell inbound handling ≥ 50 calls with ≥ 80% usable extractions
- [ ] Monthly compliance review #1 done (checklist in `03-compliance.md` §11), zero unresolved findings

## Month 3: Full 12 markets + optimization

**Goal:** all 12 markets live; optimize with data; harden operations.

- Remaining markets (Houston, San Antonio, Jacksonville, Orlando, Augusta, Knoxville, Baltimore) on the now-boring playbook: ingest 1 week → ramp outreach. **Baltimore last**, after the PHIFA contract package and MD messaging guardrails get attorney sign-off (`03-compliance.md` §9).
- Optimization: cadence A/B (step timing/channel order) per market via cadence-profile versioning; scoring weight re-fit against 90 days of reply/warm outcomes (still deterministic — re-weighting, not ML yet); template/prompt iteration from `kpi_daily` conversion by prompt version.
- Ops hardening: GCP migration if still on VPS and volume > 100k SMS/mo; quarterly restore drill #2; rate-budget re-tune with real 10DLC trust scores; dashboard takeover-mode polish from David's daily-driver feedback.
- Capacity check: at 12 markets the model predicts 15–30 warm negotiations/mo hitting one human — measure David's response latency to hot leads; if > 4 business hours median, that's the trigger for the disposition/VA conversation, not more lead flow.

**Exit criteria**
- [ ] 12/12 markets live; ~30k leads contacted/mo run-rate within budget caps
- [ ] 5–10 contracts cumulative; ≥ 2 closed (`closed_won`) with assignment fees banked
- [ ] Cost-per-deal measured ≤ $2,000; every market's cost-per-warm tracked, bottom quartile has an explicit keep/kill decision
- [ ] Zero compliance incidents; audit-log review #2 clean; TX/OH/TN registration obligations confirmed satisfied
- [ ] Runbook complete enough that a 1-week David vacation = pipeline keeps running, outreach optionally paused by kill switch

## Post-90-day backlog (ordered)

1. **ML re-ranking on outcome data.** Replace hand-set scoring weights with a model trained on 90+ days of labeled outcomes (reply/warm/contract per lead + extraction features). Keep it as a re-ranker on top of the deterministic score; Batches API for nightly inference. Exit: +20% warm-per-contact vs. static weights in an A/B.
2. **Disposition / buyer-list module.** The Scale-tier constraint is David's bandwidth; the highest-leverage relief is faster assignment: buyer CRM tables, buy-box matching, blast-to-matching-buyers (email/SMS with the same compliance gate), e-sign assignment packet integration.
3. **Driving-for-dollars mobile capture.** Field capture (photo + address → instant BatchData/ATTOM enrich + skip trace → lead at `scored`). Buy-vs-build: evaluate DealMachine (~$99/mo) as capture front-end feeding our API before building a mobile app.
4. **Second SMS vendor (Telnyx) failover** once volume justifies the 10DLC duplicate-campaign overhead.
5. **Team features**: real auth/roles on dashboard when the first VA joins (`07-scaling-security.md` §2.3 trigger).
6. **County-direct data pulls** (probate, code violations, tax sale lists) where BatchData lags — highest-alpha lists are the least productized.

## Standing cadence (from Week 3, forever)

| Rhythm | Ritual |
|---|---|
| Daily | 8am Slack digest (KPIs, warm queue, blocked-send anomalies); David clears hot-lead queue same day |
| Weekly | Thread-quality review (10 random conversations); vendor spend vs. budget; prompt/template tweaks shipped |
| Monthly | Compliance review checklist; market keep/kill review; cost model re-run vs. `05-costs.md` |
| Quarterly | Restore drill; secret rotation; attorney check-in on state-law changes (mini-TCPAs are moving fast) |
