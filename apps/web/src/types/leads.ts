export type LeadStatus = "Hot" | "Warm" | "Cold" | "Qualified" | "New" | "Contacted" | "Closed";

export type LeadSourcePlatform = "meta" | "google";

export interface Lead {
  id: string;
  name: string;
  title: string;
  company: string;
  email: string;
  phone: string;
  location: string;
  score: number; // 0 to 100
  status: LeadStatus;
  source: string;
  owner: string;
  avatar: string;
  industry: string;
  companySize: string;
  annualRevenue: string;
  techStack: string[];
  createdAt: string;
  updatedAt: string;
  tags: string[];
  notesCount: number;
  activityCount: number;
  profileUrl?: string;
  academyId?: string | null;
  sourcePlatform?: LeadSourcePlatform | null;
  externalLeadId?: string | null;
  formId?: string | null;
  campaignName?: string | null;
  adName?: string | null;
  courseInterest?: string | null;
  examYear?: string | null;
  isGuardian?: boolean | null;
  consentAt?: string | null;
  rawAnswers?: Record<string, unknown> | null;
  needsGuardianConsent?: boolean;
  scoredAt?: string | null;
  ownerId?: string | null;
  /** Stage of the lead's most recently moved deal. */
  stage?: string | null;
  lastContactedAt?: string | null;
  doNotContact?: boolean;
  consentChannel?: ConsentChannel[];
}

export type ConsentChannel = "email" | "whatsapp" | "sms" | "call";

export interface LeadListParams {
  page?: number;
  pageSize?: number;
  /** API field, prefix "-" for descending: name, company, score, status, source, createdAt, updatedAt, lastContactedAt. */
  sort?: string;
  q?: string;
  status?: string[];
  source?: string[];
  sourcePlatform?: string;
  /** "me", "unassigned" or a user id. */
  ownerId?: string;
  minScore?: number;
  maxScore?: number;
  createdFrom?: string;
  createdTo?: string;
  tags?: string[];
  campaignName?: string;
  courseInterest?: string;
  examYear?: string;
}

/** Writable lead fields (POST / PATCH /api/leads). */
export interface LeadInput {
  name?: string;
  title?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  industry?: string | null;
  companySize?: string | null;
  courseInterest?: string | null;
  examYear?: string | null;
  profileUrl?: string | null;
  score?: number;
  status?: LeadStatus;
  source?: string;
  tags?: string[];
  ownerId?: string | null;
  doNotContact?: boolean;
  consentChannel?: ConsentChannel[];
}

export interface LeadFacets {
  sources: string[];
  sourcePlatforms: string[];
  campaigns: string[];
  courses: string[];
  examYears: string[];
  tags: string[];
}

export type LeadBulkAction =
  | { action: "assign"; leadIds: string[]; ownerId: string | null }
  | { action: "status"; leadIds: string[]; status: LeadStatus }
  | { action: "tag" | "untag"; leadIds: string[]; tags: string[] }
  | { action: "delete" | "rescore"; leadIds: string[] };

export interface LeadImportResult {
  imported: number;
  duplicates: number;
  invalid: number;
  errors: { row: number; message: string }[];
}

/** CSV import: lead fields a column can be mapped to. */
export type LeadImportField =
  | "name"
  | "email"
  | "phone"
  | "company"
  | "title"
  | "location"
  | "industry"
  | "source"
  | "status"
  | "score"
  | "tags"
  | "courseInterest"
  | "examYear"
  | "profileUrl";

/** Filters the API parsed out of a natural-language lead search query. */
export interface LeadSearchFilters {
  course_interest: string | null;
  city: string | null;
  exam_year: string | null;
  source_platform: string | null;
  status: string | null;
  min_score: number | null;
  keywords: string[];
}

export type LeadSearchParser = "sarvam" | "keywords";

export type IntentSignalStatus = "new" | "replied" | "routed" | "dismissed";

export type LocationMatch = "exact" | "nearby" | "state";

/**
 * A public post showing course intent. Holds no contact data, except publishedContact when the
 * author explicitly asked to be contacted and published it in the same post.
 */
export interface IntentSignal {
  id: string;
  postUrl: string;
  sourceChannel: string;
  postExcerpt: string;
  postDate: string | null;
  city: string | null;
  courseInterest: string | null;
  urgency: string | null;
  budget: string | null;
  intentScore: number | null;
  leadRoutingCategory: string | null;
  suggestedPublicReply: string | null;
  status: IntentSignalStatus;
  /** Public username or display name shown on the post. */
  authorHandle: string | null;
  platform: string | null;
  contactRequested: boolean;
  /** Phone/email exactly as published next to the contact request. */
  publishedContact: string | null;
  contactRequestQuote: string | null;
  locationMatch: LocationMatch | null;
  searchQuery: string | null;
  searchCity: string | null;
  discoveredAt: string | null;
  createdAt: string;
}

export interface LeadSearchResult {
  query: string;
  filters: LeadSearchFilters;
  parsedBy: LeadSearchParser;
  leads: Lead[];
  signals: IntentSignal[];
}

export interface SignalImportResult {
  imported: number;
  skipped: number;
  reasons: string[];
}
