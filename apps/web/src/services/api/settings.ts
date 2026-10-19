import { deleteData, enc, getData, http, patchData, postData } from "./http";
import type {
  Invitation,
  InviteResult,
  Me,
  Member,
  NotificationPrefs,
  PendingInvite,
  ResendInviteResult,
  Role,
  WorkspaceSettings,
  WorkspaceSettingsPatch,
} from "@/types";

export interface UpdateMeInput {
  fullName?: string;
  avatarUrl?: string | null;
  notificationPrefs?: Partial<NotificationPrefs>;
  defaultOrgId?: string;
}

export const meApi = {
  get: () => getData<Me>("/me"),
  update: (input: UpdateMeInput) => patchData<Me>("/me", input),
  /** Joins with the token from an invitation email; the API checks it was sent to the signed-in email. */
  acceptInvitation: (token: string) => postData<Me>("/me/invitations/accept", { token }),
  invitations: () => getData<PendingInvite[]>("/me/invitations"),
  acceptPendingInvitation: (orgId: string) => postData<Me>(`/me/invitations/${enc(orgId)}/accept`),
  declinePendingInvitation: async (orgId: string): Promise<void> => {
    await http.post(`/me/invitations/${enc(orgId)}/decline`);
  },
};

export const settingsApi = {
  get: () => getData<WorkspaceSettings>("/settings"),
  update: (patch: WorkspaceSettingsPatch) => patchData<WorkspaceSettings>("/settings", patch),
};

export const membersApi = {
  list: () => getData<Member[]>("/members"),
  changeRole: (userId: string, role: Role) => patchData<Member | null>(`/members/${enc(userId)}`, { role }),
  remove: (userId: string) => deleteData(`/members/${enc(userId)}`),
  resendInvite: (userId: string) => postData<ResendInviteResult>(`/members/${enc(userId)}/resend-invite`),
};

export const invitationsApi = {
  list: () => getData<Invitation[]>("/invitations"),
  create: (email: string, role: Role) => postData<InviteResult>("/invitations", { email, role }),
  revoke: (id: string) => deleteData(`/invitations/${enc(id)}`),
};
