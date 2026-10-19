import { deleteData, enc, getData, patchData, postData } from "./http";
import type {
  Invitation,
  InviteResult,
  Me,
  Member,
  NotificationPrefs,
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
  acceptInvitation: (token: string) => postData<Me>("/me/invitations/accept", { token }),
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
