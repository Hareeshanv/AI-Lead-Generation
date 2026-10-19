import type { Role } from "./auth";

export interface ScoringThresholds {
  hot: number;
  warm: number;
}

export type InterestPreset = "none" | "education";

/** A custom interest or city: the label plus other spellings that should match it. */
export interface DiscoveryTerm {
  label: string;
  aliases: string[];
}

/** What lead search and the discovery agent look for in this workspace. */
export interface DiscoverySettings {
  /** What the workspace sells; used in AI prompts. */
  businessDescription: string | null;
  /** ISO 3166-1 alpha-2, lowercase. */
  country: string;
  /** Google interface language, e.g. "en". */
  language: string;
  interestPreset: InterestPreset;
  interests: DiscoveryTerm[];
  cities: DiscoveryTerm[];
}

export interface OrgSettings {
  currency: string;
  timezone: string;
  locale: string;
  scoring: ScoringThresholds;
  defaultOwnerId: string | null;
  branding: Record<string, unknown>;
  discovery: DiscoverySettings;
  updatedAt: string;
}

/** GET/PATCH /api/settings */
export interface WorkspaceSettings {
  organization: { id: string; name: string };
  settings: OrgSettings;
}

export interface WorkspaceSettingsPatch {
  name?: string;
  currency?: string;
  timezone?: string;
  locale?: string;
  scoring?: ScoringThresholds;
  defaultOwnerId?: string | null;
  /** Omitted fields keep their stored value. */
  discovery?: Partial<DiscoverySettings>;
}

export interface Member {
  userId: string;
  role: Role;
  /** "pending": invited, hasn't accepted yet (no access; can't be assigned as an owner). */
  status: "active" | "pending";
  invitationId: string | null;
  joinedAt: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  status: "pending" | "accepted" | "revoked" | "expired";
  invitedBy: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface InviteResult {
  invitation: Invitation;
  /** invited: email sent (new accounts get a sign-up link, existing ones a link to accept); pending_email_failed: saved but the email could not be sent. */
  outcome: "invited" | "pending_email_failed";
  emailError?: string;
}

/** GET /api/me/invitations: a workspace that invited the signed-in user and awaits accept/decline. */
export interface PendingInvite {
  invitationId: string;
  orgId: string;
  orgName: string;
  role: Role;
  expiresAt: string;
  createdAt: string;
}

export interface ResendInviteResult {
  outcome: "invited" | "pending_email_failed";
  emailError?: string;
}
