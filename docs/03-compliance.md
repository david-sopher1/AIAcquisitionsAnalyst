# DealEngine — Outreach Compliance Playbook

> **⚠️ THIS DOCUMENT IS NOT LEGAL ADVICE.** It is an engineering playbook summarizing our understanding of the rules as of July 2026 and how the built compliance engine maps to them. Statutes and FCC/state interpretations change constantly, TCPA plaintiff firms actively hunt for violations ($500–$1,500 *per message*), and real estate cold outreach is a top litigation target. **Review this entire playbook and your intended campaigns with a TCPA attorney before enabling any outbound channel.** See §12.

## 1. The risk in one paragraph

DealEngine sends automated SMS to skip-traced cell numbers of people who never asked to hear from us. Under the federal TCPA and a growing set of state "mini-TCPAs," automated/autodialed texts and prerecorded calls to cell phones generally require **prior express written consent** — which cold leads have not given. The industry operates in a contested gray zone (arguing human-initiated/non-ATDS sending, quiet-hours discipline, immediate opt-out honoring, low volume per number). That posture reduces risk; it does not eliminate it. Statutory damages are $500 per violation, $1,500 if willful, per message, uncapped, with a private right of action federally and in FL, OK, MD, TX and others. A single angry recipient with 10 texts is a five-figure claim. **This is why the compliance engine gates every outbound with no bypass path.**

## 2. Federal TCPA basics

| Rule | Summary | Engine mapping |
|---|---|---|
| Prior express **written** consent | Required for marketing calls/texts to cell phones using an ATDS or artificial/prerecorded voice. Cold SMS to skip-traced cells is the highest-risk activity we perform. | `consent_events` table records any consent with evidence; leads without consent get the conservative cadence profile; `OUTBOUND_ENABLED` kill switch. |
| Quiet hours | Federal telemarketing window **8am–9pm recipient local time**. | `packages/compliance` quiet-hours check uses the *lead's* market/property timezone, and the stricter of federal/state windows. |
| Opt-out honoring | Revocation by any reasonable means; must be honored promptly (FCC: within a reasonable time, now effectively immediate for texts). | Opt-out keyword scan on every inbound (STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT + fuzzy variants via Claude extraction); writes `suppressions` + `consent_events(revoked)`; one confirmation message allowed, then hard block. |
| Prerecorded voice | Artificial/prerecorded voice calls to cells require prior express written consent for marketing. **AI-generated voice = artificial voice** (FCC 2024 ruling on AI voices). | Retell AI cold-calling is disabled by default; voice is inbound-answer + manually-initiated only unless consent exists. |
| Ringless voicemail | FCC declared (Nov 2022) RVM is a "call" using prerecorded voice → TCPA applies, consent required. **RVM is not a loophole.** | Drop Cowboy adapter requires `consent_events` record present; cold RVM path is not wired. |
| Identification | Caller/sender must identify the business. | Conversation Agent system prompt mandates company identity disclosure (see `06-agents.md`); 10DLC campaign content includes it. |

## 3. National & state Do-Not-Call

- **National DNC:** scrub all cold-call and (best practice) SMS lists against the FTC National DNC Registry. Engine: when `DNC_SCRUB_KEY` is set, every new contact is scrubbed at skip-trace time and flagged rows go to `suppressions(reason='dnc_federal')`; when unset, lists must be pre-scrubbed before import and the import tool warns loudly.
- **State DNC lists:** TX, FL, TN, IN among our states maintain their own lists or piggyback the national registry with state enforcement. Indiana's DNC law is notably strict (no established-business-relationship exemption for many categories). Scrub state lists where available.
- **Litigator scrubbing:** maintain a scrub against known TCPA serial-plaintiff/litigator number lists (commercial services: e.g. Blacklist Alliance, DNC.com litigator scrub). Engine: `suppressions(reason='litigator')`, refreshed on import and monthly.

## 4. State-by-state (our 8 states)

> Verified via public legal summaries July 2026 — **counsel must confirm current text before launch.** Where a state is stricter than federal, the engine takes the stricter value.

| State | Key law(s) | Quiet hours | Frequency cap | Registration | Notes |
|---|---|---|---|---|---|
| **FL** | FTSA (Fla. Stat. §501.059) + Telemarketing Act | **8am–8pm** | **Max 3 calls/texts per 24h on same subject** | Telemarketer license unless exempt | Mini-TCPA with private right of action ($500/$1,500). 2023 amendments narrowed "autodialer" and require a 15-day cure via "STOP" reply before text suits, but FL remains the #1 mini-TCPA litigation state. Engine enforces 8pm cutoff + 3/24h cap for FL leads. |
| **TX** | Tex. Bus. & Com. Code ch. 302 + **SB 140 (eff. 2025-09-01)** extending it to SMS/MMS | 9pm cutoff (federal window applies; TX solicitation rules ride on top) | — | **Yes** — telephone solicitation registration with TX Secretary of State: ~$200 filing per location + **$10,000 security deposit**, annual. Failure = Class A misdemeanor + DTPA exposure (private suits). Later guidance: businesses texting **with prior consent** are not required to register — but our cold texts are not consent-based. **Decision required before TX SMS goes live: register, or keep TX to mail/other channels.** | Note: task briefs sometimes cite "SB 1092"; the operative 2025 statute is **SB 140** — verify with counsel. |
| **MD** | **Stop the Spam Calls Act (eff. 2024-01-01)** + PHIFA (§9 below) | **8am–8pm** | **Max 3 per 24h same subject** | — | Mini-TCPA: prior express written consent required where an automated system **selects OR dials** numbers — broader than federal ATDS. Private right of action. Also PHIFA governs purchaser conduct for owners in foreclosure. MD is our most regulated market. |
| **OH** | Telephone Solicitation Sales Act (ORC 4719) + Telemarketing Act | Federal 8am–9pm | — | Telephone solicitor **certificate of registration with the AG** required unless exempt ($50k bond context); many sellers exempt — counsel to confirm whether wholesaling outreach fits an exemption | Columbus + Toledo. |
| **GA** | GA telemarketing rules; **SB 73 (2023)** amendments | Federal window | — | — | SB 73 removed damage caps and added **vicarious liability** — we are liable for what our platform/vendors send. State DNC piggybacks national. |
| **TN** | TN Consumer Protection / telephone solicitation (§47-18-15xx); **SB 868** extended prohibitions to texts; 2026 HB 2408/SB 2659 added new oversight | Federal window | — | TN DNC program registration for solicitors (TPUC) | Texts explicitly covered since SB 868. Watch the 2026 oversight law's rulemaking. |
| **IN** | Telephone Privacy Act (IC 24-5-14) + Auto-dialer law (IC 24-5-14-5) | Federal window | — | Quarterly DNC scrub against Indiana's own list | One of the strictest state DNC regimes; Indiana AG actively enforces. Auto-dialer statute is broad — treat IN like a consent-required state for automated texts. |
| *(reference)* **OK** | OK mini-TCPA (2022) — not our market, but the model FL/MD copied | 8am–8pm | 3 per 24h | — | Included because new states keep adopting this template; the engine's per-state profile schema (window + cap + consent flag) was designed around it. |

**Engine mapping:** each state has a row in the compliance config (`packages/compliance/src/state-profiles.ts`): `{ quietStart, quietEnd, dailyCap?, per24hSameSubjectCap?, requiresConsentForAutoText?, registrationRequired? }`. The gate evaluates the lead's property state and applies the stricter of federal/state on every check, writing the evaluated profile snapshot into `outbound_compliance_log`.

## 5. 10DLC campaign registration (SMS content rules)

Carrier-level (TCR) rules, independent of law but enforced by message blocking and fines:

- Register brand (LLC + EIN) and a campaign whose **sample messages match real traffic** — including the Conversation Agent's openers.
- First message to any recipient must identify the business and include opt-out language ("Reply STOP to opt out"). The SMS manager appends this on first-touch automatically.
- Prohibited content (SHAFT), no link shorteners like bit.ly, no shared public URLs with redirects.
- Carriers require an opt-in story on the campaign; "purchased/skip-traced lists" is explicitly disfavored — expect scrutiny, lower throughput, and possible campaign rejection. Be truthful on the registration; misrepresentation risks brand suspension.
- Honor carrier-level opt-out (Twilio Advanced Opt-Out is enabled AND our own keyword scan runs — belt and suspenders; both write to `suppressions`).

## 6. Email — CAN-SPAM

Lower risk than SMS (no private right of action; opt-out model, not opt-in):

- Accurate From/Subject, physical postal address in footer, working unsubscribe honored within 10 business days (we honor instantly → `suppressions(channel='email')`).
- No harvested-address prohibitions violated: skip-trace emails are permissible-purpose data; still, keep volume low and value-first.
- SendGrid suppression list is mirrored into our `suppressions` table via webhook so a SendGrid-level unsubscribe also blocks other-channel "email" retries.

## 7. Ringless voicemail — treat as prohibited-without-consent

FCC's November 2022 declaratory ruling: RVM to a wireless number **is a call made with an artificial/prerecorded voice** → prior express consent required; marketing content → prior express **written** consent. Vendors marketing RVM as a loophole are wrong. Our posture: Drop Cowboy sends only to leads with a recorded `consent_events` grant (e.g., inbound leads who provided their number and consented to voice contact). The cadence engine will skip RVM steps for any lead without consent — this is enforced in code, not convention.

## 8. AI voice calling

- Outbound AI cold calls to cells = artificial voice + likely ATDS = prior express written consent territory. Default: **off**.
- Permitted uses as built: (a) inbound answering (seller calls our number back — an inbound call, and we still disclose identity), (b) David-initiated single calls, (c) consented callbacks ("call me tomorrow at 3" — capture consent in `consent_events` from the conversation transcript first).
- Several states are adding AI-disclosure requirements for synthetic voice; the Retell agent script discloses the company and that the call is recorded where required (two-party consent states: FL and MD among ours — **record-all requires consent announcements in FL/MD**).

## 9. Pre-foreclosure solicitation restrictions

Distress lists include pre-foreclosure owners — several states regulate *who may contact them and how deals must be papered*:

- **Maryland — PHIFA (Protection of Homeowners in Foreclosure Act, RP §7-301 et seq.)**: applies once a homeowner is **60+ days in default** or in foreclosure. Regulates "foreclosure consultants" **and "foreclosure purchasers"** — i.e., us, when buying. Requires specific written contract contents, a **5-day right of rescission**, restrictions on recording documents during the rescission window, and prohibits a long list of purchaser practices. Violations carry civil and criminal exposure. **Engine mapping:** MD leads with pre-foreclosure/default distress flags get `compliance_tags: ['md_phifa']`; the Notification Agent includes a PHIFA warning banner in the deal summary, and the Conversation Agent's MD system prompt forbids discussing sale-leaseback/rescue framings. David must use PHIFA-compliant contracts (attorney-drafted) for these deals.
- **Similar regimes** exist elsewhere (e.g., "foreclosure rescue"/home equity purchase acts in other states; Georgia and Indiana have foreclosure-rescue statutes aimed at consultants). Before enabling pre-foreclosure lists in any state, counsel confirms whether purchaser-conduct rules apply; the market config carries a `preforeclosureRestricted` flag that tightens messaging templates.
- Regardless of statute: pre-foreclosure sellers are vulnerable parties. Conversation Agent rules prohibit false urgency, "we can save your home" claims, and equity-stripping framings in **all** states.

## 10. How the compliance engine enforces all of this

Single entry point: `canContact(leadId, channel, payloadMeta) → { allowed, blockedBy?, evaluatedProfile }`. Order of checks:

1. `OUTBOUND_ENABLED` global kill switch (env) — false blocks everything, instantly, for incident response.
2. Channel enabled for market (config).
3. `suppressions` lookup (opt-out, DNC, litigator, manual, PHIFA-blocked) — any hit blocks.
4. Consent requirement: if state profile requires consent for this channel (auto-text in MD/IN posture, RVM/AI-voice everywhere) and no `consent_events` grant → block.
5. Quiet hours: stricter of federal (8–9) and state (FL/MD 8–8) in the lead's local timezone → block or reschedule to window open.
6. Frequency caps: `SMS_WEEKLY_CAP` per lead; per-24h same-subject cap (3 in FL/MD) counted across **all channels' calls/texts**, matching statute language.
7. Content lint (SMS): first-touch must contain identity + opt-out language; banned-phrase list (e.g., "guaranteed", foreclosure-rescue phrasing).
8. Write `outbound_compliance_log` row (allowed or blocked, rule fired, full evaluated profile snapshot) — **before** the vendor call. Append-only, never deleted.

Opt-out path (inbound): keyword scan → `suppressions` + `consent_events(revoked)` + Temporal signal cancels the `leadOutreach` workflow → single confirmation message (exempt from caps, still logged).

## 11. Record-keeping & audit

- `consent_events`: who, when, channel, evidence blob (message SID / call recording ref / web form payload). Retained indefinitely.
- `outbound_compliance_log`: every attempt, allowed or blocked. Retained ≥ 4 years (TCPA statute of limitations) — this log is our primary litigation defense artifact.
- `messages`: full content both directions, vendor SIDs. Retained ≥ 4 years.
- Monthly compliance review checklist (dashboard compliance panel): opt-out latency (target < 1 min), blocked-send reasons histogram, cap-hit counts, DNC scrub freshness, 10DLC campaign status.

## 12. Disclaimer

> **NOT LEGAL ADVICE. ENGINEERING DOCUMENT ONLY.** The authors are not attorneys. TCPA, FTSA, state mini-TCPAs, DNC rules, foreclosure-solicitation statutes, and carrier policies change frequently and are subject to interpretation; several statements above summarize contested areas of law. **Before enabling any outbound channel in any market, engage a TCPA/telemarketing attorney to review: (1) this playbook, (2) the actual message templates and cadences, (3) state registration obligations (TX SB 140 registration + bond, OH AG registration, TN DNC program), and (4) PHIFA-compliant contracting for Maryland pre-foreclosure deals.** Budget for this review in Phase 1 — it is cheaper than one demand letter.
