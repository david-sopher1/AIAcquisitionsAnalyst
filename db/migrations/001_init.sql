-- ============================================================================
-- DealEngine — initial schema
-- PostgreSQL 16. Single source of truth for properties, leads, outreach,
-- conversations, compliance, and deal analysis.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE property_type AS ENUM (
  'single_family', 'townhome', 'duplex', 'triplex', 'quadplex',
  'small_multifamily', 'condo', 'mobile', 'land', 'commercial', 'other'
);

CREATE TYPE lead_status AS ENUM (
  'new', 'enriching', 'skip_traced', 'scored', 'in_outreach', 'conversing',
  'warm', 'hot', 'appointment', 'offer_made', 'under_contract',
  'closed_won', 'closed_lost', 'nurture', 'dead', 'suppressed'
);

CREATE TYPE lead_temperature AS ENUM ('cold', 'warming', 'warm', 'hot');

CREATE TYPE distress_flag AS ENUM (
  'vacant', 'vacant_rental', 'probate', 'inherited', 'pre_foreclosure',
  'tax_delinquent', 'code_violation', 'water_shutoff', 'utility_disconnect',
  'tired_landlord', 'fire_damage', 'high_equity', 'free_and_clear',
  'absentee_owner', 'out_of_state_owner', 'estate_sale', 'divorce',
  'eviction_filing', 'bankruptcy', 'lien', 'expired_listing',
  'driving_for_dollars', 'usps_vacancy', 'senior_owner', 'long_ownership'
);

CREATE TYPE contact_point_type AS ENUM (
  'phone_mobile', 'phone_landline', 'phone_voip', 'phone_unknown', 'email', 'mailing_address'
);

CREATE TYPE channel AS ENUM (
  'sms', 'mms', 'email', 'rvm', 'cold_call', 'ai_voice', 'direct_mail', 'handwritten_mail'
);

CREATE TYPE touch_status AS ENUM (
  'scheduled', 'queued', 'sent', 'delivered', 'failed', 'canceled', 'blocked_compliance'
);

CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');

CREATE TYPE conversation_status AS ENUM ('active', 'awaiting_reply', 'human_takeover', 'paused', 'closed');

CREATE TYPE occupancy_status AS ENUM ('owner_occupied', 'tenant_occupied', 'vacant', 'unknown');

CREATE TYPE consent_kind AS ENUM ('opt_in', 'opt_out', 'express_written_consent', 'revoked', 'dnc_request');

CREATE TYPE repair_level AS ENUM ('cosmetic', 'light', 'medium', 'heavy', 'gut');

CREATE TYPE skip_trace_status AS ENUM ('pending', 'completed', 'failed', 'no_hit');

-- ---------------------------------------------------------------------------
-- Reference: markets
-- ---------------------------------------------------------------------------
CREATE TABLE markets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,            -- e.g. 'columbus_oh'
  city        text NOT NULL,
  state       text NOT NULL,                   -- two-letter
  counties    text[] NOT NULL DEFAULT '{}',
  zips        text[] NOT NULL DEFAULT '{}',    -- optional zip filter
  timezone    text NOT NULL,                   -- IANA, drives quiet hours
  active      boolean NOT NULL DEFAULT true,
  settings    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Properties & owners
-- ---------------------------------------------------------------------------
CREATE TABLE properties (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id          uuid REFERENCES markets(id),
  apn                text,
  address_line1      text NOT NULL,
  address_line2      text,
  city               text NOT NULL,
  state              text NOT NULL,
  zip                text NOT NULL,
  county             text,
  normalized_address text NOT NULL,            -- dedupe key (USPS-style normalization)
  lat                double precision,
  lng                double precision,
  property_type      property_type NOT NULL DEFAULT 'other',
  beds               numeric,
  baths              numeric,
  sqft               integer,
  lot_sqft           integer,
  year_built         integer,
  units              integer NOT NULL DEFAULT 1,
  last_sale_date     date,
  last_sale_price_cents bigint,
  assessed_value_cents  bigint,
  est_mortgage_balance_cents bigint,
  est_equity_pct     numeric,
  avm_value_cents    bigint,
  avm_source         text,
  avm_updated_at     timestamptz,
  flood_zone         text,
  school_rating      numeric,
  crime_index        numeric,
  data               jsonb NOT NULL DEFAULT '{}',  -- vendor raw payloads keyed by source
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (normalized_address)
);
CREATE INDEX idx_properties_market ON properties(market_id);
CREATE INDEX idx_properties_zip ON properties(zip);

CREATE TABLE owners (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_raw         text NOT NULL,
  first_name       text,
  last_name        text,
  is_entity        boolean NOT NULL DEFAULT false,
  entity_name      text,
  mailing_line1    text,
  mailing_city     text,
  mailing_state    text,
  mailing_zip      text,
  deceased         boolean,
  age              integer,
  data             jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE property_owners (
  property_id  uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  owner_id     uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  is_current   boolean NOT NULL DEFAULT true,
  role         text NOT NULL DEFAULT 'owner',
  PRIMARY KEY (property_id, owner_id)
);

-- ---------------------------------------------------------------------------
-- Lead sources & list stacking
-- ---------------------------------------------------------------------------
CREATE TABLE lead_sources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key             text NOT NULL UNIQUE,        -- 'batchdata', 'attom', 'county_tax', ...
  name            text NOT NULL,
  vendor          text,
  cost_per_record_cents integer DEFAULT 0,
  active          boolean NOT NULL DEFAULT true
);

CREATE TABLE leads (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id    uuid NOT NULL REFERENCES properties(id),
  owner_id       uuid REFERENCES owners(id),
  market_id      uuid REFERENCES markets(id),
  status         lead_status NOT NULL DEFAULT 'new',
  temperature    lead_temperature NOT NULL DEFAULT 'cold',
  score          numeric NOT NULL DEFAULT 0,          -- 0..100 composite
  score_breakdown jsonb NOT NULL DEFAULT '{}',
  stack_count    integer NOT NULL DEFAULT 1,          -- distinct sources
  assigned_to    uuid,
  next_action_at timestamptz,
  last_contact_at timestamptz,
  human_takeover boolean NOT NULL DEFAULT false,
  archived_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id)
);
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_score ON leads(score DESC);
CREATE INDEX idx_leads_next_action ON leads(next_action_at);
CREATE INDEX idx_leads_market ON leads(market_id);

CREATE TABLE lead_source_hits (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  source_id   uuid NOT NULL REFERENCES lead_sources(id),
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  raw         jsonb NOT NULL DEFAULT '{}',
  UNIQUE (lead_id, source_id)
);

CREATE TABLE lead_distress_flags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  flag        distress_flag NOT NULL,
  source_key  text,
  details     jsonb NOT NULL DEFAULT '{}',
  detected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, flag)
);
CREATE INDEX idx_flags_lead ON lead_distress_flags(lead_id);

-- ---------------------------------------------------------------------------
-- Skip tracing & contact points
-- ---------------------------------------------------------------------------
CREATE TABLE skip_traces (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  vendor       text NOT NULL,
  status       skip_trace_status NOT NULL DEFAULT 'pending',
  cost_cents   integer DEFAULT 0,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  raw          jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE contact_points (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       uuid REFERENCES owners(id) ON DELETE CASCADE,
  lead_id        uuid REFERENCES leads(id) ON DELETE SET NULL,
  type           contact_point_type NOT NULL,
  value          text NOT NULL,               -- E.164 for phones, lowercase for email
  carrier        text,
  confidence     numeric,                     -- 0..1 from skip trace vendor
  dnc_listed     boolean NOT NULL DEFAULT false,
  litigator_risk boolean NOT NULL DEFAULT false,
  opted_out      boolean NOT NULL DEFAULT false,
  verified       boolean NOT NULL DEFAULT false,
  preferred      boolean NOT NULL DEFAULT false,
  source         text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, type, value)
);
CREATE INDEX idx_contact_points_value ON contact_points(value);

-- ---------------------------------------------------------------------------
-- Compliance
-- ---------------------------------------------------------------------------
CREATE TABLE consent_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_point_id uuid REFERENCES contact_points(id) ON DELETE CASCADE,
  lead_id          uuid REFERENCES leads(id) ON DELETE SET NULL,
  kind             consent_kind NOT NULL,
  channel          channel,
  evidence         jsonb NOT NULL DEFAULT '{}',  -- raw message, call recording ref, etc.
  occurred_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE suppressions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  value      text NOT NULL,                     -- phone E.164, email, or normalized address
  value_type text NOT NULL CHECK (value_type IN ('phone','email','address')),
  reason     text NOT NULL,                     -- 'opt_out', 'dnc', 'litigator', 'manual', 'bounced'
  source     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (value, value_type)
);

CREATE TABLE outbound_compliance_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  touch_id       uuid,
  lead_id        uuid,
  contact_value  text,
  channel        channel,
  allowed        boolean NOT NULL,
  blocked_reason text,
  checks         jsonb NOT NULL DEFAULT '{}',   -- each rule evaluated + result
  evaluated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_compliance_log_lead ON outbound_compliance_log(lead_id);

-- ---------------------------------------------------------------------------
-- Campaigns, sequences, touches
-- ---------------------------------------------------------------------------
CREATE TABLE campaigns (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key        text NOT NULL UNIQUE,
  name       text NOT NULL,
  market_id  uuid REFERENCES markets(id),
  active     boolean NOT NULL DEFAULT true,
  config     jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sequences (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  key         text NOT NULL,
  name        text NOT NULL,
  steps       jsonb NOT NULL,   -- [{stepNo, channel, dayOffset, templateKey, window}]
  UNIQUE (campaign_id, key)
);

CREATE TABLE touches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id             uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  campaign_id         uuid REFERENCES campaigns(id),
  sequence_key        text,
  step_no             integer,
  channel             channel NOT NULL,
  contact_point_id    uuid REFERENCES contact_points(id),
  scheduled_at        timestamptz NOT NULL,
  sent_at             timestamptz,
  status              touch_status NOT NULL DEFAULT 'scheduled',
  provider            text,
  provider_message_id text,
  cost_cents          integer DEFAULT 0,
  body_preview        text,
  meta                jsonb NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_touches_lead ON touches(lead_id);
CREATE INDEX idx_touches_status_sched ON touches(status, scheduled_at);

-- ---------------------------------------------------------------------------
-- Conversations & messages
-- ---------------------------------------------------------------------------
CREATE TABLE conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id          uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  channel          channel NOT NULL,
  contact_point_id uuid REFERENCES contact_points(id),
  status           conversation_status NOT NULL DEFAULT 'active',
  last_inbound_at  timestamptz,
  last_outbound_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, channel, contact_point_id)
);

CREATE TABLE messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id     uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction           message_direction NOT NULL,
  channel             channel NOT NULL,
  body                text NOT NULL,
  media               jsonb,
  provider_message_id text,
  ai_generated        boolean NOT NULL DEFAULT false,
  intent              text,                     -- classified: interested, not_interested, question, callback, opt_out, wrong_number
  model_meta          jsonb,                    -- model id, tokens, latency
  sent_at             timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, sent_at);

-- ---------------------------------------------------------------------------
-- Qualification (structured seller intel, updated by Conversation Agent)
-- ---------------------------------------------------------------------------
CREATE TABLE qualifications (
  lead_id              uuid PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  motivation_level     text,        -- none | low | medium | high | urgent
  motivation_notes     text,
  reason_for_selling   text,
  timeline_weeks       integer,
  timeline_notes       text,
  asking_price_cents   bigint,
  price_flexible       boolean,
  condition_notes      text,
  repairs_needed       text,
  repair_level_guess   repair_level,
  occupancy            occupancy_status DEFAULT 'unknown',
  mortgage_status      text,        -- free_and_clear | current | behind | in_foreclosure | unknown
  mortgage_balance_cents bigint,
  best_contact_method  channel,
  best_contact_time    text,
  callback_at          timestamptz,
  objections           jsonb NOT NULL DEFAULT '[]',
  conversation_summary text,
  qualified            boolean NOT NULL DEFAULT false,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Valuation, repairs, deal analysis
-- ---------------------------------------------------------------------------
CREATE TABLE comps (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id    uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  source         text NOT NULL,
  address        text NOT NULL,
  sale_date      date,
  sale_price_cents bigint,
  sqft           integer,
  beds           numeric,
  baths          numeric,
  distance_miles numeric,
  similarity     numeric,          -- 0..1
  raw            jsonb NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE valuations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  arv_cents    bigint NOT NULL,
  arv_low_cents  bigint,
  arv_high_cents bigint,
  method       text NOT NULL,      -- 'comp_weighted', 'avm', 'ai_blend'
  confidence   numeric,
  comp_ids     uuid[],
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE repair_estimates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  lead_id     uuid REFERENCES leads(id) ON DELETE CASCADE,
  level       repair_level NOT NULL,
  psf_cents   integer NOT NULL,
  total_cents bigint NOT NULL,
  breakdown   jsonb NOT NULL DEFAULT '{}',
  source      text NOT NULL,       -- 'heuristic' | 'ai' | 'human'
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE deal_analyses (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id                uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  arv_cents              bigint NOT NULL,
  repairs_cents          bigint NOT NULL,
  mao_cents              bigint NOT NULL,
  mao_rule_pct           numeric NOT NULL,      -- e.g. 0.70
  holding_cents          bigint NOT NULL DEFAULT 0,
  closing_cents          bigint NOT NULL DEFAULT 0,
  assignment_fee_cents   bigint NOT NULL DEFAULT 0,
  wholesale_spread_cents bigint,
  flip_profit_cents      bigint,
  rent_estimate_cents    bigint,
  coc_return             numeric,
  brrrr                  jsonb,
  strategy               text,                  -- 'wholesale' | 'flip' | 'brrrr' | 'pass'
  inputs                 jsonb NOT NULL DEFAULT '{}',
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_deal_analyses_lead ON deal_analyses(lead_id, created_at DESC);

CREATE TABLE offers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  amount_cents bigint NOT NULL,
  status       text NOT NULL DEFAULT 'draft',   -- draft | sent | countered | accepted | rejected | expired
  sent_at      timestamptz,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Users, notifications, audit
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text NOT NULL UNIQUE,
  name               text NOT NULL,
  role               text NOT NULL DEFAULT 'admin',
  phone              text,
  slack_user_id      text,
  notification_prefs jsonb NOT NULL DEFAULT '{"sms":true,"email":true,"slack":true,"push":true}',
  api_key_hash       text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text NOT NULL,          -- 'warm_lead' | 'hot_lead' | 'callback' | 'system'
  lead_id    uuid REFERENCES leads(id) ON DELETE CASCADE,
  title      text NOT NULL,
  body       text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}',   -- deal summary etc.
  channels   jsonb NOT NULL DEFAULT '[]',   -- delivery results per channel
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz
);

CREATE TABLE audit_log (
  id        bigserial PRIMARY KEY,
  actor     text NOT NULL,            -- 'system:<agent>' or user id
  action    text NOT NULL,
  entity    text NOT NULL,
  entity_id text,
  before    jsonb,
  after     jsonb,
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);

CREATE TABLE webhook_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    text NOT NULL,
  event_type  text,
  payload     jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed   boolean NOT NULL DEFAULT false,
  error       text
);

-- ---------------------------------------------------------------------------
-- KPI rollups (materialized daily by Dashboard Agent)
-- ---------------------------------------------------------------------------
CREATE TABLE kpi_daily (
  date                 date NOT NULL,
  market_id            uuid REFERENCES markets(id),
  new_leads            integer NOT NULL DEFAULT 0,
  skip_traced          integer NOT NULL DEFAULT 0,
  touches_sent         integer NOT NULL DEFAULT 0,
  responses            integer NOT NULL DEFAULT 0,
  conversations_active integer NOT NULL DEFAULT 0,
  warm_leads           integer NOT NULL DEFAULT 0,
  hot_leads            integer NOT NULL DEFAULT 0,
  appointments         integer NOT NULL DEFAULT 0,
  offers_made          integer NOT NULL DEFAULT 0,
  contracts            integer NOT NULL DEFAULT 0,
  spend_cents          bigint NOT NULL DEFAULT 0,
  pipeline_value_cents bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (date, market_id)
);

-- updated_at triggers
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_properties_updated BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_owners_updated BEFORE UPDATE ON owners
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_leads_updated BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
