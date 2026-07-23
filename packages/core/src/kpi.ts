// Dashboard Agent — materialize kpi_daily per market (run nightly + on demand).
import { query } from "@dealengine/shared";

export async function rollupKpisForDate(date: string): Promise<void> {
  await query(
    `INSERT INTO kpi_daily (date, market_id, new_leads, skip_traced, touches_sent,
        responses, conversations_active, warm_leads, hot_leads, appointments,
        offers_made, contracts, spend_cents, pipeline_value_cents)
     SELECT
       $1::date,
       m.id,
       (SELECT count(*) FROM leads l WHERE l.market_id = m.id AND l.created_at::date = $1::date),
       (SELECT count(*) FROM skip_traces st JOIN leads l ON l.id = st.lead_id
         WHERE l.market_id = m.id AND st.completed_at::date = $1::date AND st.status = 'completed'),
       (SELECT count(*) FROM touches t JOIN leads l ON l.id = t.lead_id
         WHERE l.market_id = m.id AND t.sent_at::date = $1::date AND t.status IN ('sent','delivered')),
       (SELECT count(*) FROM messages msg JOIN conversations c ON c.id = msg.conversation_id
         JOIN leads l ON l.id = c.lead_id
         WHERE l.market_id = m.id AND msg.direction = 'inbound' AND msg.sent_at::date = $1::date),
       (SELECT count(*) FROM conversations c JOIN leads l ON l.id = c.lead_id
         WHERE l.market_id = m.id AND c.status IN ('active','awaiting_reply')),
       (SELECT count(*) FROM leads l WHERE l.market_id = m.id AND l.status = 'warm'),
       (SELECT count(*) FROM leads l WHERE l.market_id = m.id AND l.status = 'hot'),
       (SELECT count(*) FROM leads l WHERE l.market_id = m.id AND l.status = 'appointment'),
       (SELECT count(*) FROM offers o JOIN leads l ON l.id = o.lead_id
         WHERE l.market_id = m.id AND o.sent_at::date = $1::date),
       (SELECT count(*) FROM leads l WHERE l.market_id = m.id AND l.status = 'under_contract'),
       (SELECT COALESCE(sum(t.cost_cents),0) FROM touches t JOIN leads l ON l.id = t.lead_id
         WHERE l.market_id = m.id AND t.sent_at::date = $1::date)
       + (SELECT COALESCE(sum(st.cost_cents),0) FROM skip_traces st JOIN leads l ON l.id = st.lead_id
           WHERE l.market_id = m.id AND st.completed_at::date = $1::date),
       (SELECT COALESCE(sum(da.assignment_fee_cents),0)
          FROM deal_analyses da JOIN leads l ON l.id = da.lead_id
         WHERE l.market_id = m.id AND l.status IN ('warm','hot','appointment','offer_made','under_contract')
           AND da.id = (SELECT id FROM deal_analyses WHERE lead_id = l.id ORDER BY created_at DESC LIMIT 1))
     FROM markets m
     ON CONFLICT (date, market_id) DO UPDATE SET
       new_leads = EXCLUDED.new_leads,
       skip_traced = EXCLUDED.skip_traced,
       touches_sent = EXCLUDED.touches_sent,
       responses = EXCLUDED.responses,
       conversations_active = EXCLUDED.conversations_active,
       warm_leads = EXCLUDED.warm_leads,
       hot_leads = EXCLUDED.hot_leads,
       appointments = EXCLUDED.appointments,
       offers_made = EXCLUDED.offers_made,
       contracts = EXCLUDED.contracts,
       spend_cents = EXCLUDED.spend_cents,
       pipeline_value_cents = EXCLUDED.pipeline_value_cents`,
    [date],
  );
}
