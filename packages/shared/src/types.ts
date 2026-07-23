// ============================================================================
// Domain types — mirror db/migrations/001_init.sql
// ============================================================================

export type PropertyType =
  | "single_family"
  | "townhome"
  | "duplex"
  | "triplex"
  | "quadplex"
  | "small_multifamily"
  | "condo"
  | "mobile"
  | "land"
  | "commercial"
  | "other";

export type LeadStatus =
  | "new"
  | "enriching"
  | "skip_traced"
  | "scored"
  | "in_outreach"
  | "conversing"
  | "warm"
  | "hot"
  | "appointment"
  | "offer_made"
  | "under_contract"
  | "closed_won"
  | "closed_lost"
  | "nurture"
  | "dead"
  | "suppressed";

export type LeadTemperature = "cold" | "warming" | "warm" | "hot";

export type DistressFlag =
  | "vacant"
  | "vacant_rental"
  | "probate"
  | "inherited"
  | "pre_foreclosure"
  | "tax_delinquent"
  | "code_violation"
  | "water_shutoff"
  | "utility_disconnect"
  | "tired_landlord"
  | "fire_damage"
  | "high_equity"
  | "free_and_clear"
  | "absentee_owner"
  | "out_of_state_owner"
  | "estate_sale"
  | "divorce"
  | "eviction_filing"
  | "bankruptcy"
  | "lien"
  | "expired_listing"
  | "driving_for_dollars"
  | "usps_vacancy"
  | "senior_owner"
  | "long_ownership";

export type Channel =
  | "sms"
  | "mms"
  | "email"
  | "rvm"
  | "cold_call"
  | "ai_voice"
  | "direct_mail"
  | "handwritten_mail";

export type TouchStatus =
  | "scheduled"
  | "queued"
  | "sent"
  | "delivered"
  | "failed"
  | "canceled"
  | "blocked_compliance";

export type ContactPointType =
  | "phone_mobile"
  | "phone_landline"
  | "phone_voip"
  | "phone_unknown"
  | "email"
  | "mailing_address";

export type OccupancyStatus = "owner_occupied" | "tenant_occupied" | "vacant" | "unknown";

export type RepairLevel = "cosmetic" | "light" | "medium" | "heavy" | "gut";

export type MessageIntent =
  | "interested"
  | "maybe_later"
  | "question"
  | "callback_request"
  | "price_given"
  | "not_interested"
  | "wrong_number"
  | "opt_out"
  | "hostile"
  | "other";

export interface Market {
  id: string;
  key: string;
  city: string;
  state: string;
  counties: string[];
  zips: string[];
  timezone: string;
  active: boolean;
}

export interface PropertyRecord {
  id: string;
  marketId: string | null;
  apn: string | null;
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
  county: string | null;
  normalizedAddress: string;
  propertyType: PropertyType;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  yearBuilt: number | null;
  units: number;
  lastSaleDate: string | null;
  lastSalePriceCents: number | null;
  assessedValueCents: number | null;
  estMortgageBalanceCents: number | null;
  estEquityPct: number | null;
  avmValueCents: number | null;
}

export interface OwnerRecord {
  id: string;
  nameRaw: string;
  firstName: string | null;
  lastName: string | null;
  isEntity: boolean;
  mailingLine1: string | null;
  mailingCity: string | null;
  mailingState: string | null;
  mailingZip: string | null;
  age: number | null;
  deceased: boolean | null;
}

export interface LeadRecord {
  id: string;
  propertyId: string;
  ownerId: string | null;
  marketId: string | null;
  status: LeadStatus;
  temperature: LeadTemperature;
  score: number;
  scoreBreakdown: Record<string, number>;
  stackCount: number;
  nextActionAt: string | null;
  lastContactAt: string | null;
  humanTakeover: boolean;
  createdAt: string;
}

export interface ContactPoint {
  id: string;
  ownerId: string | null;
  leadId: string | null;
  type: ContactPointType;
  value: string;
  confidence: number | null;
  dncListed: boolean;
  litigatorRisk: boolean;
  optedOut: boolean;
  preferred: boolean;
  source: string | null;
}

export interface Qualification {
  leadId: string;
  motivationLevel: "none" | "low" | "medium" | "high" | "urgent" | null;
  motivationNotes: string | null;
  reasonForSelling: string | null;
  timelineWeeks: number | null;
  timelineNotes: string | null;
  askingPriceCents: number | null;
  priceFlexible: boolean | null;
  conditionNotes: string | null;
  repairsNeeded: string | null;
  repairLevelGuess: RepairLevel | null;
  occupancy: OccupancyStatus;
  mortgageStatus: "free_and_clear" | "current" | "behind" | "in_foreclosure" | "unknown" | null;
  mortgageBalanceCents: number | null;
  bestContactMethod: Channel | null;
  bestContactTime: string | null;
  callbackAt: string | null;
  objections: string[];
  conversationSummary: string | null;
  qualified: boolean;
}

export interface SequenceStep {
  stepNo: number;
  channel: Channel;
  /** Days after sequence start. */
  dayOffset: number;
  templateKey: string;
  /** Optional local-time window like "10:00-18:00". */
  window?: string;
}

export interface DealAnalysis {
  leadId: string;
  arvCents: number;
  repairsCents: number;
  maoCents: number;
  maoRulePct: number;
  holdingCents: number;
  closingCents: number;
  assignmentFeeCents: number;
  wholesaleSpreadCents: number | null;
  flipProfitCents: number | null;
  rentEstimateCents: number | null;
  cocReturn: number | null;
  strategy: "wholesale" | "flip" | "brrrr" | "pass";
}

export interface RawLeadInput {
  sourceKey: string;
  marketKey: string;
  address: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    zip: string;
    county?: string;
  };
  apn?: string;
  ownerName?: string;
  ownerMailing?: { line1?: string; city?: string; state?: string; zip?: string };
  propertyType?: PropertyType;
  beds?: number;
  baths?: number;
  sqft?: number;
  yearBuilt?: number;
  units?: number;
  lastSaleDate?: string;
  lastSalePriceCents?: number;
  assessedValueCents?: number;
  avmValueCents?: number;
  estEquityPct?: number;
  flags: DistressFlag[];
  raw?: Record<string, unknown>;
}

/** Deal summary pushed to the owner when a lead goes warm/hot. */
export interface DealSummary {
  leadId: string;
  address: string;
  ownerName: string;
  phone: string | null;
  temperature: LeadTemperature;
  motivation: string;
  timeline: string;
  askingPrice: string;
  estimatedRepairs: string;
  estimatedArv: string;
  suggestedMao: string;
  occupancy: string;
  mortgageStatus: string;
  conversationSummary: string;
  objections: string[];
  recommendedNextAction: string;
}
