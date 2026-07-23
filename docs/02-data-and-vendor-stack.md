# DealEngine — Data & Vendor Stack

> **Every price below is an estimate gathered from public sources in July 2026. Verify at signup — vendors reprice constantly, and most of these are negotiated at volume.**

## 1. Philosophy

- **Two data vendors, not five.** BatchData is the workhorse (lists + skip tracing in one contract, one adapter). ATTOM is the depth layer (property detail, comps, AVM) that underwriting needs. Everything else is optional.
- **Buy usage, not seats.** We are an API-first platform; avoid per-seat SaaS (DealMachine, PropStream) except where a human workflow genuinely needs it.
- **Postgres is the CRM.** GoHighLevel is an optional one-way mirror, never the source of truth. Don't pay for CRM features we've built.

## 2. Primary stack (what the codebase integrates)

| Vendor | Role | Pricing (verify at signup) | Adapter status |
|---|---|---|---|
| **BatchData** | Property lists (distress filters) + skip tracing, primary | Property data from ~$1,000/mo for 100k records (Growth); skip trace from ~$2,000/mo for 100k traces; lower committed tiers and per-hit pricing are negotiable — ask for a starter tier well below these published floors | **Built** (`packages/integrations/batchdata`) |
| **ATTOM Data** | Property detail, comps, AVM, foreclosure/lien data | No public rates; reported entry points ~$500/mo range for basic API packages, custom quotes by endpoint + volume; 30-day trial/sandbox available | **Built** (`packages/integrations/attom`) |
| **Twilio** | SMS/MMS + 10DLC | ~$0.0079/segment outbound + ~$0.003 carrier fee ≈ $0.011/segment effective; $44 one-time brand reg (low-volume standard), ~$15 campaign vetting, ~$1.50–$10/campaign/mo; numbers ~$1.15/mo each | **Built** (`packages/integrations/twilio`) |
| **SendGrid** | Email (nurture + notifications) | Essentials from ~$19.95/mo (to 100k emails); Pro ~$89.95/mo; free tier is now a 60-day trial only | **Built** (`packages/integrations/sendgrid`) |
| **Retell AI** | AI voice (cold-call manager + inbound answer) | Base ~$0.07/min voice engine; realistic all-in $0.13–$0.31/min once LLM + telephony + TTS included; pay-as-you-go, no mandatory subscription | **Built** (`packages/integrations/retell`) |
| **Drop Cowboy** | Ringless voicemail | BYOC from ~$0.004/drop + ~$0.0031 compliance fee; bundled plans from ~$125/mo | **Built** (`packages/integrations/dropcowboy`) — **default OFF; see 03-compliance.md, RVM = prerecorded call under TCPA** |
| **Lob** | Postcards + letters | ~$0.48/postcard, ~$0.69/letter print+post; platform plans (e.g. Growth ~$550/mo for up to 6k pieces) on top — start on the lowest plan | **Built** (`packages/integrations/lob`) |
| **Handwrytten** | Robot-handwritten letters for high-score leads | ~$3.25–$5.00/note + postage at cost; API on business plans | **Built** (`packages/integrations/handwrytten`) |
| **Anthropic Claude** | Conversation, extraction, scoring assist, summaries | Opus 4.8 $5/$25 per 1M tokens (in/out); Sonnet 5 $3/$15 (intro $2/$10 through 2026-08-31); Haiku 4.5 $1/$5; Batches API −50% (nightly bulk scoring) | **Built** (`packages/ai`) |
| **Slack** | Owner notifications (incoming webhook) | Free | **Built** |
| **PropertyRadar** | Optional secondary list source (esp. CA-style county data quality; useful for TX/FL niches) | Solo $119/mo, Team $249/mo, Business $599/mo (API on Business) | **Planned** (adapter stub) |
| **IDI Core / Enformion** | Premium skip-trace waterfall (2nd pass on BatchData misses) | Pay-as-you-go, roughly $0.50–$2.00/record, no monthly minimums typical; requires credentialing/permissible-purpose vetting | **Planned** (waterfall hook exists in Skip Trace Agent) |
| **GoHighLevel** | Optional one-way CRM mirror | ~$97–$297/mo if used | **Planned** (one-way sync worker, off by default) |

## 3. Alternatives considered (and why not)

| Vendor | Considered for | Verdict |
|---|---|---|
| **PropStream** | Lists + comps | Seat-based UI product, weak API story. BatchData+ATTOM covers it programmatically. Skip. |
| **DealMachine** | Driving for dollars | ~$99/mo (annual) plus credit-based add-ons for mail/skip trace. Good mobile capture UX we don't want to rebuild — revisit in the post-90-day roadmap as a *capture front-end* feeding our pipeline via CSV/Zapier, not as a CRM. |
| **Tracers** | Skip tracing | Investigator-grade database (Enformion family). Overlaps IDI/Enformion; pick one premium waterfall vendor, not two. |
| **REISkip / SkipGenie** | Cheap bulk skip | Comparable hit rates to BatchData at similar $, one more vendor to manage. Skip unless BatchData hit-rate disappoints in a market. |
| **Melissa / Smarty** | Address normalization | BatchData address APIs + our own normalizer are adequate at current scale. Revisit at 1M+ records. |
| **Slybroadcast** | RVM | Same legal posture as Drop Cowboy, similar price. No reason to switch. |
| **Plivo / Telnyx** | SMS | 10–20% cheaper per segment than Twilio, but Twilio's 10DLC tooling, deliverability insight, and docs are worth the premium for a solo operator. Revisit at 200k+ SMS/mo. |
| **Vapi / Bland.ai** | AI voice | Comparable pricing (~$0.05–0.10/min base + stack costs). Retell chosen for maturity of webhooks + call analysis payloads that map cleanly onto our extraction pipeline. |

## 4. What to buy first (phased)

### Phase 1 — minimum viable stack (Weeks 1–4, ~2 markets)

Buy, in order:

1. **Twilio** — account, 2 local numbers per market, start 10DLC brand + campaign registration **on day 1** (vetting takes days-to-weeks and blocks all SMS).
2. **BatchData** — smallest committed tier that covers ~5k records + 2.5k traces/mo. Negotiate: they publish enterprise floors but sell smaller starter packages.
3. **ATTOM** — 30-day trial → smallest package with property detail + sales comps + AVM endpoints for your counties only.
4. **Anthropic** — API key; default `claude-opus-4-8`, and set `AI_MODEL_SCORING=claude-haiku-4-5` immediately (scoring assist doesn't need Opus).
5. **SendGrid Essentials** — ~$20/mo; also carries system notifications.
6. **Slack** — free incoming webhook.

Estimated Phase 1 vendor spend: **$1,500–2,500/mo** (dominated by BatchData + ATTOM). See `05-costs.md`.

### Phase 2 — additions (Month 2+)

7. **Lob** — turn on postcards for high-score/no-phone leads (mail has no TCPA exposure).
8. **Handwrytten** — top-decile leads only (score ≥ 85, equity-rich, absentee).
9. **Retell AI** — AI voice, *manually-initiated and inbound-first* posture per compliance doc.
10. **IDI/Enformion** — second-pass skip trace waterfall once you can measure BatchData miss rate (expect 20–30% of records to need a second pass).
11. **Drop Cowboy** — only for leads with documented prior express consent (i.e., re-engagement of inbound leads). Not for cold outreach. See `03-compliance.md`.
12. **PropertyRadar Business** — only if a market's BatchData list quality proves weak.

## 5. Vendor-specific integration notes

### BatchData
- One API family for both list pulls (`/property/search` with distress filters: pre-foreclosure, tax delinquent, absentee, vacant, high equity, probate flags) and skip tracing.
- Dedupe on APN + county FIPS before skip tracing — never pay to trace a record twice. The Data Cleaning Agent enforces this.
- Track per-market hit rate (`contacts.source='batchdata'` with ≥1 mobile) in `kpi_daily`; below ~65% mobile-hit, enable the IDI waterfall for that market.

### ATTOM
- We call: property detail, sales comps, AVM, and (package-dependent) pre-foreclosure. Cache aggressively — property facts change slowly; the adapter caches detail for 30 days, AVM/comps for 7.
- Comps power the underwriting blend: ARV = weighted comps (weights by distance/recency/similarity) blended with ATTOM AVM. Keep the AVM endpoint in-contract or underwriting quality drops.

### Twilio / 10DLC
- Register as **sole prop or LLC brand** (LLC strongly preferred — EIN improves trust score and throughput). Campaign use case: "Direct Lending / Real Estate" style marketing campaign; sample messages you submit **must match** what the Conversation Agent actually sends, including opt-out language.
- Throughput is trust-score dependent; expect limited T-Mobile daily caps at low trust. Plan number pools accordingly (the SMS manager rotates numbers per market).
- Webhook signature verification is mandatory in `services/api` (see `07-scaling-security.md`).

### Anthropic
- Batches API (50% off) is used for the nightly bulk scoring assist run — never for conversation (latency).
- Intro Sonnet 5 pricing ($2/$10) ends **2026-08-31**; re-run the cost model in `05-costs.md` after that date if you've downgraded conversation to Sonnet.

## 6. Contract checklist (every vendor)

- [ ] Month-to-month or ≤12-month term; no auto-escalators.
- [ ] Data usage rights: confirm we may **store** returned data in our DB (some ATTOM packages restrict caching/retention — get it in writing).
- [ ] Skip-trace vendors: confirm permissible-purpose basis and our obligations (GLBA/DPPA data handling — see `07-scaling-security.md` PII section).
- [ ] Overage pricing in writing.
- [ ] API rate limits in writing — these feed the rate budgets in `services/workers`.
- [ ] Cancellation path tested before scale-up.

## 7. Sources (pricing verified July 2026)

- BatchData pricing: [batchdata.io/pricing](https://batchdata.io/pricing), [pricing comparison](https://batchdata.io/blog/real-estate-data-api-pricing-comparison-batchdata-competitors)
- ATTOM: [attomdata.com Property Data API](https://www.attomdata.com/solutions/delivery/property-data-api/), [Datarade profile](https://datarade.ai/data-providers/attom/profile)
- Twilio: [US SMS pricing](https://www.twilio.com/en-us/sms/pricing/us), [A2P 10DLC](https://www.twilio.com/en-us/phone-numbers/a2p-10dlc)
- Retell AI: [pricing breakdown](https://www.cekura.ai/blogs/retell-ai-pricing-per-minute), [Retell blog](https://www.retellai.com/blog/ai-voice-agent-pricing-full-cost-breakdown-platform-comparison-roi-analysis)
- Drop Cowboy: [messaging pricing](https://www.dropcowboy.com/messaging-pricing)
- Lob: [pricing details](https://help.lob.com/print-and-mail/ready-to-get-started/pricing-details)
- Handwrytten: [pricing](https://www.handwrytten.com/pricing/)
- SendGrid: [pricing overview](https://costbench.com/software/email-api/sendgrid/)
- PropertyRadar: [subscription guide](https://help.propertyradar.com/en/articles/1023141-which-subscription-meets-my-needs)
- IDI/Enformion: [IDI skip tracing](https://www.ididata.com/skip-tracing/)
- DealMachine: [pricing reviews](https://resimpli.com/blog/dealmachine-pricing/)
