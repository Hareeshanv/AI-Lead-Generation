import { useQuery } from "@tanstack/react-query";
import { invitationsApi, meApi, membersApi, settingsApi } from "@/services/api";
import { switchWorkspace } from "@/lib/auth";
import type { InviteResult, Me, PendingInvite, ResendInviteResult, Role, WorkspaceSettings, WorkspaceSettingsPatch } from "@/types";
import { queryKeys } from "./queryKeys";
import { useApiMutation } from "./useApiMutation";

export function useWorkspaceSettings() {
  return useQuery({ queryKey: queryKeys.settings, queryFn: settingsApi.get });
}

export function useUpdateWorkspaceSettings() {
  return useApiMutation<WorkspaceSettings, WorkspaceSettingsPatch>({
    mutationFn: settingsApi.update,
    invalidate: [queryKeys.settings, queryKeys.me],
    successMessage: "Workspace settings saved",
  });
}

export function useMembers() {
  return useQuery({ queryKey: queryKeys.members, queryFn: membersApi.list });
}

export function useChangeMemberRole() {
  return useApiMutation<unknown, { userId: string; role: Role }>({
    mutationFn: ({ userId, role }) => membersApi.changeRole(userId, role),
    invalidate: [queryKeys.members, queryKeys.me],
    successMessage: "Role updated",
  });
}

export function useRemoveMember() {
  return useApiMutation<void, string>({
    mutationFn: membersApi.remove,
    invalidate: [queryKeys.members],
    successMessage: "Member removed",
  });
}

/** Revokes a pending invitee's invitation (removes their pending membership). */
export function useRevokePendingMember() {
  return useApiMutation<void, string>({
    mutationFn: membersApi.remove,
    invalidate: [queryKeys.members, queryKeys.invitations],
    successMessage: "Invitation revoked",
  });
}

export function useResendInvite() {
  return useApiMutation<ResendInviteResult, string>({
    mutationFn: membersApi.resendInvite,
    successMessage: (result) =>
      result.outcome === "invited"
        ? "Invitation email sent again"
        : `The invitation email could not be sent${result.emailError ? `: ${result.emailError}` : ""}`,
  });
}

/** Admin only; pass enabled=false for other roles to skip the request. */
export function useInvitations(enabled = true) {
  return useQuery({ queryKey: queryKeys.invitations, queryFn: invitationsApi.list, enabled });
}

export function useInviteMember() {
  return useApiMutation<InviteResult, { email: string; role: Role }>({
    mutationFn: ({ email, role }) => invitationsApi.create(email, role),
    invalidate: [queryKeys.invitations, queryKeys.members],
    successMessage: (result) =>
      result.outcome === "invited"
        ? `Invitation sent to ${result.invitation.email}`
        : `Invitation saved, but the email could not be sent${result.emailError ? `: ${result.emailError}` : ""}`,
  });
}

/** Workspaces that invited the signed-in user (existing accounts must accept explicitly). */
export function usePendingInvitations() {
  return useQuery({ queryKey: queryKeys.myInvitations, queryFn: meApi.invitations, staleTime: 5 * 60_000 });
}

/** Joins the workspace and switches to it (full reload, so the old workspace's cache is dropped). */
export function useAcceptPendingInvitation() {
  return useApiMutation<Me, PendingInvite>({
    mutationFn: (invite) => meApi.acceptPendingInvitation(invite.orgId),
    successMessage: (_me, invite) => `You joined ${invite.orgName}`,
    onSuccess: (_me, invite) => switchWorkspace(invite.orgId),
  });
}

export function useDeclinePendingInvitation() {
  return useApiMutation<void, PendingInvite>({
    mutationFn: (invite) => meApi.declinePendingInvitation(invite.orgId),
    invalidate: [queryKeys.myInvitations],
    successMessage: (_r, invite) => `Declined the invitation to ${invite.orgName}`,
  });
}

export function useRevokeInvitation() {
  return useApiMutation<void, string>({
    mutationFn: invitationsApi.revoke,
    invalidate: [queryKeys.invitations],
    successMessage: "Invitation revoked",
  });
}
