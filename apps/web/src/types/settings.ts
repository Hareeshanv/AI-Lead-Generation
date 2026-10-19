import type { Role } from "./auth";

export interface ScoringThresholds {
  hot: number;
  warm: number;
}

export interface OrgSettings {
  currency: string;
  timezone: string;
  locale: string;
  scoring: ScoringThresholds;
  defaultOwnerId: string | null;
  branding: Record<string, unknown>;
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
  /** added: existing account joined now; invited: email sent; pending_email_failed: saved but the email could not be sent. */
  outcome: "added" | "invited" | "pending_email_failed";
  emailError?: string;
}

export interface ResendInviteResult {
  outcome: "invited" | "pending_email_failed";
  emailError?: string;
}
