// ============================================================================
// Dashboard REST API — /api/v1/*, guarded by x-api-key (DASHBOARD_API_KEY).
// Contract shared with apps/dashboard.
// ============================================================================

import type { FastifyInstance } from "fastify";
import { audit, getConfig, query, queryOne, type Channel } from "@dealengine/shared";
import { sendTouch } from "@dealengine/core";
import { signalStopOutreach } from "../temporal.js";

const LEAD_LIST_SELECT = `
  SELECT l.id,
         p.address_line1 AS address, p.city, p.state, p.zip,
         o.name_raw AS owner_name,
         l.status::text, l.temperature::text, l.score, l.stack_count,
         COALESCE((SELECT array_agg(f.flag::text) FROM lead_distress_flags f WHERE f.lead_id = l.id), '{}') AS flags,
         l.last_contact_at, l.next_action_at, l.created_at
    FROM leads l
    JOIN properties p ON p.id = l.property_id
    LEFT JOIN owners o ON o.id = l.owner_id`;

function mapLeadRow(r: Record<string, unknown>) {
  return {
    id: r.id,
    address: r.address,
    city: r.city,
    state: r.state,
    zip: r.zip,
    ownerName: r.owner_name,
    status: r.status,
    temperature: r.temperature,
    score: Number(r.score),
    stackCount: r.stack_count,
    flags: r.flags ?? [],
    lastContactAt: r.last_contact_at,
    nextActionAt: r.next_action_at,
    createdAt: r.created_at,
  };
}

export async function apiRoutes(app: FastifyInstance) {
  const cfg = getConfig();

  // API-key guard for everything under /api
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    const key = req.headers["x-api-key"];
    if (key !== cfg.DASHBOARD_API_KEY) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  // --- KPIs ----------------------------------------------------------------
  app.get<{ Querystring: { days?: string } }>("/api/v1/kpis", async (req) => {
    const days = Math.min(parseInt(req.query.days ?? "30", 10) || 30, 365);
    const series = await query(
      `SELECT date::text,
              sum(new_leads)::int AS new_leads, sum(skip_traced)::int AS skip_traced,
              sum(touches_sent)::int AS touches_sent, sum(responses)::int AS responses,
              sum(warm_leads)::int AS warm_leads, sum(hot_leads)::int AS hot_leads,
              sum(appointments)::int AS appointments, sum(offers_made)::int AS offers_made,
              sum(contracts)::int AS contracts, sum(spend_cents)::bigint AS spend_cents,
              sum(pipeline_value_cents)::bigint AS pipeline_value_cents
         FROM kpi_daily
        WHERE date > current_date - $1::int
        GROUP BY date ORDER BY date`,
      [days],
    );
    const rows = series.rows.map((r) => ({
      date: r.date,
      newLeads: r.new_leads,
      skipTraced: r.skip_traced,
      touchesSent: r.touches_sent,
      responses: r.responses,
      warmLeads: r.warm_leads,
      hotLeads: r.hot_leads,
      appointments: r.appointments,
      offersMade: r.offers_made,
      contracts: r.contracts,
      spendCents: Number(r.spend_cents ?? 0),
      pipelineValueCents: Number(r.pipeline_value_cents ?? 0),
    }));
    const today = rows[rows.length - 1] ?? emptyKpi();
    const totals = rows.reduce(
      (acc, r) => ({
        date: "totals",
        newLeads: acc.newLeads + r.newLeads,
        skipTraced: acc.skipTraced + r.skipTraced,
        touchesSent: acc.touchesSent + r.touchesSent,
        responses: acc.responses + r.responses,
        warmLeads: r.warmLeads,
        hotLeads: r.hotLeads,
        appointments: r.appointments,
        offersMade: acc.offersMade + r.offersMade,
        contracts: r.contracts,
        spendCents: acc.spendCents + r.spendCents,
        pipelineValueCents: r.pipelineValueCents,
      }),
      emptyKpi(),
    );
    return { today, series: rows, totals };
  });

  // --- Leads list ----------------------------------------------------------
  app.get<{
    Querystring: {
      status?: string; temperature?: string; market?: string; q?: string;
      page?: string; pageSize?: string; sort?: string;
    };
  }>("/api/v1/leads", async (req) => {
    const { status, temperature, market, q } = req.query;
    const page = Math.max(parseInt(req.query.page ?? "1", 10) || 1, 1);
    const pageSize = Math.min(parseInt(req.query.pageSize ?? "50", 10) || 50, 200);

    const where: string[] = [];
    const params: unknown[] = [];
    const add = (clause: string, value: unknown) => {
      params.push(value);
      where.push(clause.replace("?", `$${params.length}`));
    };
    if (status) add(`l.status = ?::lead_status`, status);
    if (temperature) add(`l.temperature = ?::lead_temperature`, temperature);
    if (market) add(`l.market_id = (SELECT id FROM markets WHERE key = ?)`, market);
    if (q) {
      params.push(`%${q}%`);
      where.push(`(p.address_line1 ILIKE $${params.length} OR o.name_raw ILIKE $${params.length})`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const sortSql =
      req.query.sort === "score_asc" ? "l.score ASC"
      : req.query.sort === "created" ? "l.created_at DESC"
      : "l.score DESC";

    const totalRes = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM leads l
        JOIN properties p ON p.id = l.property_id
        LEFT JOIN owners o ON o.id = l.owner_id ${whereSql}`,
      params,
    );
    const items = await query(
      `${LEAD_LIST_SELECT} ${whereSql} ORDER BY ${sortSql}
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params,
    );
    return {
      items: items.rows.map(mapLeadRow),
      total: parseInt(totalRes.rows[0]?.n ?? "0", 10),
    };
  });

  // --- Lead detail ---------------------------------------------------------
  app.get<{ Params: { id: string } }>("/api/v1/leads/:id", async (req, reply) => {
    const leadRow = await queryOne(
      `${LEAD_LIST_SELECT.replace("SELECT l.id,", "SELECT l.id, l.human_takeover,")}
        WHERE l.id = $1`,
      [req.params.id],
    );
    if (!leadRow) return reply.code(404).send({ error: "not found" });

    const property = await queryOne(
      `SELECT p.property_type::text, p.beds, p.baths, p.sqft, p.year_built, p.units,
              p.last_sale_date, p.last_sale_price_cents::bigint AS last_sale_price_cents,
              p.avm_value_cents::bigint AS avm_value_cents, p.est_equity_pct
         FROM properties p JOIN leads l ON l.property_id = p.id WHERE l.id = $1`,
      [req.params.id],
    );
    const owner = await queryOne(
      `SELECT o.name_raw, o.is_entity,
              concat_ws(', ', o.mailing_line1, o.mailing_city, o.mailing_state, o.mailing_zip) AS mailing_address
         FROM owners o JOIN leads l ON l.owner_id = o.id WHERE l.id = $1`,
      [req.params.id],
    );
    const contactPoints = await query(
      `SELECT id, type::text, value, confidence, opted_out, dnc_listed
         FROM contact_points WHERE lead_id = $1 ORDER BY preferred DESC, type`,
      [req.params.id],
    );
    const qual = await queryOne(
      `SELECT motivation_level, reason_for_selling, timeline_weeks,
              asking_price_cents::bigint AS asking_price_cents, occupancy::text,
              mortgage_status, condition_notes, best_contact_method::text,
              callback_at, objections, conversation_summary, qualified
         FROM qualifications WHERE lead_id = $1`,
      [req.params.id],
    );
    const deal = await queryOne(
      `SELECT arv_cents::bigint AS arv_cents, repairs_cents::bigint AS repairs_cents,
              mao_cents::bigint AS mao_cents, mao_rule_pct,
              assignment_fee_cents::bigint AS assignment_fee_cents,
              flip_profit_cents::bigint AS flip_profit_cents,
              rent_estimate_cents::bigint AS rent_estimate_cents, strategy
         FROM deal_analyses WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [req.params.id],
    );
    const touches = await query(
      `SELECT id, channel::text, status::text, scheduled_at, sent_at, body_preview
         FROM touches WHERE lead_id = $1 ORDER BY scheduled_at DESC LIMIT 50`,
      [req.params.id],
    );
    const conversations = await query(
      `SELECT id, channel::text, status::text, last_inbound_at
         FROM conversations WHERE lead_id = $1`,
      [req.params.id],
    );

    const base = mapLeadRow(leadRow as Record<string, unknown>);
    return {
      lead: { ...base, humanTakeover: (leadRow as { human_takeover?: boolean }).human_takeover ?? false },
      property: property
        ? {
            propertyType: (property as any).property_type,
            beds: (property as any).beds,
            baths: (property as any).baths,
            sqft: (property as any).sqft,
            yearBuilt: (property as any).year_built,
            units: (property as any).units,
            lastSaleDate: (property as any).last_sale_date,
            lastSalePriceCents: numOrNull((property as any).last_sale_price_cents),
            avmValueCents: numOrNull((property as any).avm_value_cents),
            estEquityPct: (property as any).est_equity_pct != null ? Number((property as any).est_equity_pct) : null,
          }
        : null,
      owner: owner
        ? {
            name: (owner as any).name_raw,
            isEntity: (owner as any).is_entity,
            mailingAddress: (owner as any).mailing_address,
          }
        : null,
      contactPoints: contactPoints.rows.map((c: any) => ({
        id: c.id, type: c.type, value: c.value,
        confidence: c.confidence != null ? Number(c.confidence) : null,
        optedOut: c.opted_out, dncListed: c.dnc_listed,
      })),
      flags: base.flags,
      qualification: qual
        ? {
            motivationLevel: (qual as any).motivation_level,
            reasonForSelling: (qual as any).reason_for_selling,
            timelineWeeks: (qual as any).timeline_weeks,
            askingPriceCents: numOrNull((qual as any).asking_price_cents),
            occupancy: (qual as any).occupancy,
            mortgageStatus: (qual as any).mortgage_status,
            conditionNotes: (qual as any).condition_notes,
            bestContactMethod: (qual as any).best_contact_method,
            callbackAt: (qual as any).callback_at,
            objections: (qual as any).objections ?? [],
            conversationSummary: (qual as any).conversation_summary,
            qualified: (qual as any).qualified,
          }
        : null,
      dealAnalysis: deal
        ? {
            arvCents: numOrNull((deal as any).arv_cents),
            repairsCents: numOrNull((deal as any).repairs_cents),
            maoCents: numOrNull((deal as any).mao_cents),
            maoRulePct: Number((deal as any).mao_rule_pct),
            assignmentFeeCents: numOrNull((deal as any).assignment_fee_cents),
            flipProfitCents: numOrNull((deal as any).flip_profit_cents),
            rentEstimateCents: numOrNull((deal as any).rent_estimate_cents),
            strategy: (deal as any).strategy,
          }
        : null,
      touches: touches.rows.map((t: any) => ({
        id: t.id, channel: t.channel, status: t.status,
        scheduledAt: t.scheduled_at, sentAt: t.sent_at, bodyPreview: t.body_preview,
      })),
      conversations: conversations.rows.map((c: any) => ({
        id: c.id, channel: c.channel, status: c.status, lastInboundAt: c.last_inbound_at,
      })),
    };
  });

  // --- Takeover toggle -----------------------------------------------------
  app.post<{ Params: { id: string }; Body: { on: boolean } }>(
    "/api/v1/leads/:id/takeover",
    async (req) => {
      const on = Boolean(req.body?.on);
      await query(`UPDATE leads SET human_takeover = $2 WHERE id = $1`, [req.params.id, on]);
      await query(
        `UPDATE conversations SET status = $2 WHERE lead_id = $1 AND status <> 'closed'`,
        [req.params.id, on ? "human_takeover" : "active"],
      );
      if (on) await signalStopOutreach(req.params.id, "human_takeover");
      await audit("user:dashboard", on ? "takeover_on" : "takeover_off", "lead", req.params.id);
      return { ok: true };
    },
  );

  // --- Conversation messages ----------------------------------------------
  app.get<{ Params: { id: string } }>("/api/v1/conversations/:id/messages", async (req) => {
    const messages = await query(
      `SELECT id, direction::text, channel::text, body, intent, ai_generated, sent_at
         FROM messages WHERE conversation_id = $1 ORDER BY sent_at ASC LIMIT 500`,
      [req.params.id],
    );
    return {
      messages: messages.rows.map((m: any) => ({
        id: m.id, direction: m.direction, channel: m.channel, body: m.body,
        intent: m.intent, aiGenerated: m.ai_generated, sentAt: m.sent_at,
      })),
    };
  });

  // Human send (from dashboard, takeover mode).
  app.post<{ Params: { id: string }; Body: { body: string } }>(
    "/api/v1/conversations/:id/messages",
    async (req, reply) => {
      const convo = await queryOne<{ lead_id: string; channel: Channel }>(
        `SELECT lead_id, channel FROM conversations WHERE id = $1`,
        [req.params.id],
      );
      if (!convo) return reply.code(404).send({ error: "conversation not found" });
      const text = (req.body?.body ?? "").trim();
      if (!text) return reply.code(400).send({ error: "empty body" });
      const result = await sendTouch({
        leadId: convo.lead_id,
        channel: convo.channel === "ai_voice" ? "sms" : convo.channel,
        body: text,
        actor: "user:dashboard",
      });
      if (result.status !== "sent") {
        return reply.code(422).send({ error: result.blockedReason ?? result.status });
      }
      return { ok: true };
    },
  );

  // --- Pipeline board ------------------------------------------------------
  app.get("/api/v1/pipeline", async () => {
    const statuses = [
      "new", "in_outreach", "conversing", "warm", "hot",
      "appointment", "offer_made", "under_contract",
    ];
    const columns = [];
    for (const status of statuses) {
      const count = await queryOne<{ n: string }>(
        `SELECT count(*)::text AS n FROM leads WHERE status = $1::lead_status`,
        [status],
      );
      const leads = await query(
        `${LEAD_LIST_SELECT} WHERE l.status = $1::lead_status ORDER BY l.score DESC LIMIT 20`,
        [status],
      );
      columns.push({
        status,
        count: parseInt(count?.n ?? "0", 10),
        leads: leads.rows.map(mapLeadRow),
      });
    }
    return { columns };
  });

  // --- Notifications -------------------------------------------------------
  app.get<{ Querystring: { unread?: string } }>("/api/v1/notifications", async (req) => {
    const unreadOnly = req.query.unread === "1";
    const items = await query(
      `SELECT id, kind, lead_id, title, body, created_at, read_at
         FROM notifications ${unreadOnly ? "WHERE read_at IS NULL" : ""}
        ORDER BY created_at DESC LIMIT 100`,
    );
    return {
      items: items.rows.map((n: any) => ({
        id: n.id, kind: n.kind, leadId: n.lead_id, title: n.title,
        body: n.body, createdAt: n.created_at, readAt: n.read_at,
      })),
    };
  });

  app.post<{ Params: { id: string } }>("/api/v1/notifications/:id/read", async (req) => {
    await query(`UPDATE notifications SET read_at = now() WHERE id = $1`, [req.params.id]);
    return { ok: true };
  });

  // --- Source performance --------------------------------------------------
  app.get("/api/v1/sources/performance", async () => {
    const rows = await query(
      `SELECT s.key AS source,
              count(DISTINCT h.lead_id)::int AS leads,
              count(DISTINCT CASE WHEN l.status IN ('conversing','warm','hot','appointment','offer_made','under_contract','closed_won') THEN l.id END)::int AS responses,
              count(DISTINCT CASE WHEN l.status IN ('warm','appointment') THEN l.id END)::int AS warm,
              count(DISTINCT CASE WHEN l.status IN ('hot','offer_made','under_contract','closed_won') THEN l.id END)::int AS hot,
              COALESCE(sum(s.cost_per_record_cents),0)::bigint AS cost_cents
         FROM lead_sources s
         JOIN lead_source_hits h ON h.source_id = s.id
         JOIN leads l ON l.id = h.lead_id
        GROUP BY s.key ORDER BY leads DESC`,
    );
    return {
      items: rows.rows.map((r: any) => ({
        source: r.source, leads: r.leads, responses: r.responses,
        warm: r.warm, hot: r.hot, costCents: Number(r.cost_cents),
      })),
    };
  });

  // --- Markets -------------------------------------------------------------
  app.get("/api/v1/markets", async () => {
    const rows = await query(`SELECT id, key, city, state, active FROM markets ORDER BY state, city`);
    return { items: rows.rows };
  });
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function emptyKpi() {
  return {
    date: "", newLeads: 0, skipTraced: 0, touchesSent: 0, responses: 0,
    warmLeads: 0, hotLeads: 0, appointments: 0, offersMade: 0, contracts: 0,
    spendCents: 0, pipelineValueCents: 0,
  };
}
