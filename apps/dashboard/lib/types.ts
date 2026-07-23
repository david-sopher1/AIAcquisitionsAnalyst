export interface KpiRow {
  date: string;
  newLeads: number;
  skipTraced: number;
  touchesSent: number;
  responses: number;
  warmLeads: number;
  hotLeads: number;
  appointments: number;
  offersMade: number;
  contracts: number;
  spendCents: number;
  pipelineValueCents: number;
}

export interface KpisResponse {
  today: KpiRow;
  series: KpiRow[];
  totals: KpiRow;
}

export interface LeadListItem {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  ownerName: string;
  status: string;
  temperature: string;
  score: number;
  stackCount: number;
  flags: string[];
  lastContactAt: string | null;
  nextActionAt: string | null;
  createdAt: string;
}

export interface LeadsResponse {
  items: LeadListItem[];
  total: number;
}

export interface PropertyInfo {
  propertyType: string | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  yearBuilt: number | null;
  units: number | null;
  lastSaleDate: string | null;
  lastSalePriceCents: number | null;
  avmValueCents: number | null;
  estEquityPct: number | null;
}

export interface OwnerInfo {
  name: string;
  mailingAddress: string | null;
  isEntity: boolean;
}

export interface ContactPoint {
  id: string;
  type: string;
  value: string;
  confidence: number;
  optedOut: boolean;
  dncListed: boolean;
}

export interface Qualification {
  motivationLevel: string | null;
  reasonForSelling: string | null;
  timelineWeeks: number | null;
  askingPriceCents: number | null;
  occupancy: string | null;
  mortgageStatus: string | null;
  conditionNotes: string | null;
  bestContactMethod: string | null;
  callbackAt: string | null;
  objections: string[];
  conversationSummary: string | null;
  qualified: boolean;
}

export interface DealAnalysis {
  arvCents: number;
  repairsCents: number;
  maoCents: number;
  maoRulePct: number;
  assignmentFeeCents: number;
  flipProfitCents: number;
  rentEstimateCents: number;
  strategy: string;
}

export interface Touch {
  id: string;
  channel: string;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  bodyPreview: string | null;
}

export interface ConversationSummary {
  id: string;
  channel: string;
  status: string;
  lastInboundAt: string | null;
}

export interface LeadDetailResponse {
  lead: LeadListItem & { humanTakeover: boolean };
  property: PropertyInfo | null;
  owner: OwnerInfo | null;
  contactPoints: ContactPoint[];
  flags: string[];
  qualification: Qualification | null;
  dealAnalysis: DealAnalysis | null;
  touches: Touch[];
  conversations: ConversationSummary[];
}

export interface Message {
  id: string;
  direction: "inbound" | "outbound";
  channel: string;
  body: string;
  intent: string | null;
  aiGenerated: boolean;
  sentAt: string;
}

export interface MessagesResponse {
  messages: Message[];
}

export interface PipelineColumn {
  status: string;
  count: number;
  leads: LeadListItem[];
}

export interface PipelineResponse {
  columns: PipelineColumn[];
}

export interface NotificationItem {
  id: string;
  kind: string;
  leadId: string | null;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationsResponse {
  items: NotificationItem[];
}

export interface SourcePerformance {
  source: string;
  leads: number;
  responses: number;
  warm: number;
  hot: number;
  costCents: number;
}

export interface SourcesResponse {
  items: SourcePerformance[];
}

export interface Market {
  id: string;
  key: string;
  city: string;
  state: string;
  active: boolean;
}

export interface MarketsResponse {
  items: Market[];
}

export interface OkResponse {
  ok: boolean;
}
