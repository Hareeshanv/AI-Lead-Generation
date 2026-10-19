export type CampaignStatus = "draft" | "scheduled" | "active" | "paused" | "completed";
export type CampaignChannel = "email" | "whatsapp";
export type RecipientStatus =
  | "pending"
  | "active"
  | "completed"
  | "replied"
  | "bounced"
  | "unsubscribed"
  | "failed"
  | "skipped";
export type ExclusionReason = "do_not_contact" | "no_consent" | "unsubscribed" | "missing_address";

/** "filter": leads matching the criteria (none = all leads) plus manual adds; "manual": only manual adds. */
export interface CampaignAudienceFilter {
  type: "filter" | "manual";
  statuses?: string[];
  sources?: string[];
  tags?: string[];
  minScore?: number;
  maxScore?: number;
  ownerId?: string | null;
  createdAfter?: string;
  createdBefore?: string;
  courseInterest?: string;
  location?: string;
  q?: string;
}

/** Days: 0 = Sunday ... 6 = Saturday. Empty = any time. */
export interface CampaignSendWindow {
  start?: string;
  end?: string;
  days?: number[];
  timezone?: string;
}

export interface CampaignFromIdentity {
  name?: string;
  email?: string;
  replyTo?: string;
  phoneNumberId?: string;
}

export interface WhatsAppStepTemplate {
  name: string;
  language: string;
  /** Values for {{1}}, {{2}}, ... in the approved template body; may use {{first_name}} etc. */
  bodyParams?: string[];
  components?: Record<string, unknown>[];
}

export interface CampaignStepInput {
  delayMinutes: number;
  subject?: string | null;
  body?: string | null;
  whatsappTemplate?: WhatsAppStepTemplate | null;
}

export interface CampaignStep extends CampaignStepInput {
  id: string;
  position: number;
}

export interface CampaignStats {
  recipients: number;
  recipientsByStatus: Record<RecipientStatus, number>;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  failed: number;
  deliveryRate: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  bounceRate: number;
}

export interface CampaignFunnelStage {
  key: "recipients" | "sent" | "delivered" | "opened" | "clicked" | "replied";
  label: string;
  value: number;
}

export interface Campaign {
  id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  channel: CampaignChannel;
  audienceFilter: CampaignAudienceFilter;
  sendWindow: CampaignSendWindow;
  throttlePerHour: number;
  fromIdentity: CampaignFromIdentity;
  scheduledAt: string | null;
  launchedAt: string | null;
  completedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  stepsCount: number | null;
  /** Cached stats (refreshed on every send and provider event). Rates are percentages. */
  totalLeads: number;
  sentCount: number;
  deliveredCount: number;
  bouncedCount: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
}

export interface CampaignDetail extends Campaign {
  steps: CampaignStep[];
  stats: CampaignStats;
  funnel: CampaignFunnelStage[];
  /** False when the channel's provider is not configured; launch is blocked. */
  channelReady: boolean;
  channelError: string | null;
}

export interface CampaignInput {
  name: string;
  description?: string | null;
  channel: CampaignChannel;
  audienceFilter?: CampaignAudienceFilter;
  sendWindow?: CampaignSendWindow;
  throttlePerHour?: number;
  fromIdentity?: CampaignFromIdentity;
  scheduledAt?: string | null;
  steps?: CampaignStepInput[];
}

export interface AudiencePreview {
  matched: number;
  manual: number;
  eligible: number;
  excluded: Record<ExclusionReason, number>;
  capped: boolean;
  sample: { id: string; name: string | null; company: string | null; address: string }[];
}

export interface CampaignMessageSummary {
  id: string;
  status: string;
  toAddress: string | null;
  subject: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  repliedAt: string | null;
  bouncedAt: string | null;
  failedAt: string | null;
  error: string | null;
}

export interface CampaignRecipient {
  id: string;
  leadId: string;
  lead: {
    id: string;
    name: string | null;
    company: string | null;
    email: string | null;
    phone: string | null;
    status: string | null;
    score: number | null;
  } | null;
  status: RecipientStatus;
  currentStep: number;
  nextRunAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessage: CampaignMessageSummary | null;
}

export interface LaunchCampaignResult {
  campaign: CampaignDetail;
  recipients: number;
  skipped: number;
  excluded: Record<ExclusionReason, number>;
  firstSendAt: string | null;
}

export interface AddLeadsToCampaignResult {
  added: number;
  alreadyInCampaign: number;
  notFound: number;
  skipped: number;
  excluded: Record<ExclusionReason, number>;
  queued: number;
}
