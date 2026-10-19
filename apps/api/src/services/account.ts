import {
  orgsDb,
  settingsDb,
  type InvitationRow,
  type MemberRow,
  type OrgSettingsRow,
  type PendingInviteRow,
  type ProfileRow,
} from "@ai-lead-gen/database";
import { normalizeDiscoverySettings } from "../../../../services/search/vocabulary";

export function webAppUrl(): string {
  return (process.env.WEB_APP_URL || "http://localhost:3000").split(",")[0].trim().replace(/\/+$/, "");
}

export const NOTIFICATION_PREF_KEYS = [
  "newLead",
  "leadAssigned",
  "dealStageChanged",
  "taskDue",
  "campaignReplied",
  "agentRunCompleted",
  "workflowFailed",
  "integrationError",
  "emailDigest",
] as const;

export type NotificationPrefKey = (typeof NOTIFICATION_PREF_KEYS)[number];
export type NotificationPrefs = Record<NotificationPrefKey, boolean>;

const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  newLead: true,
  leadAssigned: true,
  dealStageChanged: true,
  taskDue: true,
  campaignReplied: true,
  agentRunCompleted: true,
  workflowFailed: true,
  integrationError: true,
  emailDigest: false,
};

export function notificationPrefs(raw: unknown): NotificationPrefs {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const prefs = { ...DEFAULT_NOTIFICATION_PREFS };
  for (const key of NOTIFICATION_PREF_KEYS) if (typeof source[key] === "boolean") prefs[key] = source[key] as boolean;
  return prefs;
}

export function toProfileDto(profile: ProfileRow) {
  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    avatarUrl: profile.avatar_url,
    defaultOrgId: profile.default_org_id,
    notificationPrefs: notificationPrefs(profile.notification_prefs),
  };
}

export function toSettingsDto(settings: OrgSettingsRow) {
  return {
    currency: settings.currency,
    timezone: settings.timezone,
    locale: settings.locale,
    scoring: settings.scoring,
    defaultOwnerId: settings.default_owner_id,
    branding: settings.branding ?? {},
    discovery: normalizeDiscoverySettings(settings.discovery),
    updatedAt: settings.updated_at,
  };
}

export function toMemberDto(member: MemberRow) {
  const status = member.status ?? "active";
  // A pending invitee's profile details would reveal that the email already had an account.
  const profile = status === "active" ? member.profile : null;
  return {
    userId: member.user_id,
    role: member.role,
    status,
    invitationId: member.invitation_id ?? null,
    joinedAt: member.created_at,
    email: member.profile?.email ?? null,
    fullName: profile?.full_name ?? null,
    avatarUrl: profile?.avatar_url ?? null,
  };
}

export function toPendingInviteDto(invite: PendingInviteRow) {
  return {
    invitationId: invite.invitation.id,
    orgId: invite.org_id,
    orgName: invite.org_name,
    role: invite.role,
    expiresAt: invite.invitation.expires_at,
    createdAt: invite.created_at,
  };
}

export function toInvitationDto(invitation: InvitationRow) {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    invitedBy: invitation.invited_by,
    expiresAt: invitation.expires_at,
    createdAt: invitation.created_at,
  };
}

/** The signed-in user's profile, memberships and active workspace; creates a workspace if they have none. */
export async function loadAccount(
  user: { id: string; email: string | null; metadata: Record<string, any> },
  activeOrgId: string
) {
  const profile = await orgsDb.ensureProfile(user.id, user.email, user.metadata.full_name ?? null);
  let memberships = await orgsDb.getMemberships(user.id);
  let orgId = activeOrgId;

  if (memberships.length === 0) {
    const name =
      (typeof user.metadata.org_name === "string" && user.metadata.org_name.trim()) ||
      `${profile.full_name || (user.email || "My").split("@")[0]}'s Workspace`;
    orgId = await orgsDb.createOrganization(name, user.id);
    memberships = await orgsDb.getMemberships(user.id);
  }

  const active = memberships.find((m) => m.org_id === orgId) || memberships[0];
  const settings = await settingsDb.get(active.org_id);
  const freshProfile = (await orgsDb.getProfile(user.id)) || profile;

  return {
    user: toProfileDto(freshProfile),
    organization: { id: active.org_id, name: active.organizations?.name ?? "Workspace" },
    role: active.role,
    memberships: memberships.map((m) => ({ orgId: m.org_id, name: m.organizations?.name ?? "Workspace", role: m.role })),
    settings: toSettingsDto(settings),
  };
}
