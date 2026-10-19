import type { OrgSettings } from "./settings";

export type Role = "admin" | "manager" | "member";

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

export interface Profile {
  id: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  defaultOrgId: string | null;
  notificationPrefs: NotificationPrefs;
}

export interface Membership {
  orgId: string;
  name: string;
  role: Role;
}

/** GET /api/me — the signed-in user and their active workspace. */
export interface Me {
  user: Profile;
  organization: { id: string; name: string };
  role: Role;
  memberships: Membership[];
  settings: OrgSettings;
}
