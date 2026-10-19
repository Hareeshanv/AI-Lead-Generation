import { dbClient } from "../client";
import { dbError, UNIQUE_VIOLATION } from "../helpers";

export type OrgRole = "admin" | "manager" | "member";

export interface MembershipRow {
  org_id: string;
  user_id: string;
  role: OrgRole;
  created_at: string;
  organizations: { id: string; name: string } | null;
}

/** "pending": invited but not yet accepted; no access and cannot own records. */
export type MemberStatus = "active" | "pending";

export interface MemberRow {
  org_id: string;
  user_id: string;
  role: OrgRole;
  status: MemberStatus;
  invitation_id: string | null;
  created_at: string;
  profile: { id: string; email: string | null; full_name: string | null; avatar_url: string | null } | null;
}

export interface ProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  default_org_id: string | null;
  notification_prefs: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface InvitationRow {
  id: string;
  org_id: string;
  email: string;
  role: OrgRole;
  token: string;
  invited_by: string | null;
  status: "pending" | "accepted" | "revoked" | "expired";
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export interface PendingInviteRow {
  org_id: string;
  org_name: string;
  role: OrgRole;
  invitation: InvitationRow;
  created_at: string;
}

const one = <T>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);

export const orgsDb = {
  /** Active memberships only. */
  async getMemberships(userId: string): Promise<MembershipRow[]> {
    const { data, error } = await dbClient
      .from("org_members")
      .select("org_id, user_id, role, created_at, organizations(id, name)")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: true });
    if (error) throw dbError("get memberships", error);
    return (data || []).map((m: any) => ({ ...m, organizations: one(m.organizations) }));
  },

  /** Active membership (or pending too with includePending); null when there is none. */
  async getMembership(
    orgId: string,
    userId: string,
    options: { includePending?: boolean } = {}
  ): Promise<{ role: OrgRole; status: MemberStatus; invitation_id: string | null; requires_acceptance: boolean } | null> {
    let query = dbClient
      .from("org_members")
      .select("role, status, invitation_id, requires_acceptance")
      .eq("org_id", orgId)
      .eq("user_id", userId);
    if (!options.includePending) query = query.eq("status", "active");
    const { data, error } = await query.maybeSingle();
    if (error) throw dbError("get membership", error);
    return data as { role: OrgRole; status: MemberStatus; invitation_id: string | null; requires_acceptance: boolean } | null;
  },

  /**
   * Activates pending memberships (accepting their invitations); returns the orgs joined.
   * Without orgId only memberships that do not need explicit acceptance are activated.
   */
  async acceptPendingMemberships(userId: string, orgId?: string): Promise<{ org_id: string; role: OrgRole }[]> {
    const { data, error } = await dbClient.rpc("accept_pending_memberships", {
      p_user: userId,
      ...(orgId ? { p_org_id: orgId } : {}),
    });
    if (error) throw dbError("accept pending memberships", error);
    return (data || []) as { org_id: string; role: OrgRole }[];
  },

  /** Invitations to an existing account waiting for that user's decision (not expired or revoked). */
  async listPendingInvitesForUser(userId: string): Promise<PendingInviteRow[]> {
    const { data: rows, error } = await dbClient
      .from("org_members")
      .select("org_id, role, invitation_id, created_at, organizations(id, name)")
      .eq("user_id", userId)
      .eq("status", "pending")
      .eq("requires_acceptance", true)
      .order("created_at", { ascending: false });
    if (error) throw dbError("list pending invites", error);
    const invitationIds = (rows || []).map((r: any) => r.invitation_id).filter(Boolean) as string[];
    const invitations = new Map<string, InvitationRow>();
    if (invitationIds.length > 0) {
      const { data, error: invError } = await dbClient.from("invitations").select("*").in("id", invitationIds);
      if (invError) throw dbError("list pending invites", invError);
      for (const inv of (data || []) as InvitationRow[]) invitations.set(inv.id, inv);
    }
    const now = Date.now();
    return (rows || []).flatMap((r: any) => {
      const invitation = r.invitation_id ? invitations.get(r.invitation_id) : undefined;
      if (!invitation || invitation.status !== "pending" || Date.parse(invitation.expires_at) <= now) return [];
      const org = one(r.organizations) as { id: string; name: string } | null;
      return [{ org_id: r.org_id, org_name: org?.name ?? "Workspace", role: r.role, invitation, created_at: r.created_at }];
    });
  },

  /** Deletes the user's own pending membership (declining the invite); returns its invitation id. */
  async declinePendingMembership(userId: string, orgId: string): Promise<{ invitation_id: string | null } | null> {
    const { data, error } = await dbClient
      .from("org_members")
      .delete()
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .eq("status", "pending")
      .select("invitation_id")
      .maybeSingle();
    if (error) throw dbError("decline invitation", error);
    return data as { invitation_id: string | null } | null;
  },

  /** Creates the org, its settings row and an admin membership (SECURITY DEFINER RPC). */
  async createOrganization(name: string, ownerId: string): Promise<string> {
    const { data, error } = await dbClient.rpc("create_organization", { p_name: name, p_owner: ownerId });
    if (error) throw dbError("create organization", error);
    return data as string;
  },

  async getOrganization(orgId: string) {
    const { data, error } = await dbClient.from("organizations").select("*").eq("id", orgId).maybeSingle();
    if (error) throw dbError("get organization", error);
    return data;
  },

  async updateOrganization(orgId: string, patch: { name?: string }) {
    const { data, error } = await dbClient.from("organizations").update(patch).eq("id", orgId).select().single();
    if (error) throw dbError("update organization", error);
    return data;
  },

  async getProfile(userId: string): Promise<ProfileRow | null> {
    const { data, error } = await dbClient.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (error) throw dbError("get profile", error);
    return data as ProfileRow | null;
  },

  async ensureProfile(userId: string, email: string | null, fullName?: string | null): Promise<ProfileRow> {
    const existing = await orgsDb.getProfile(userId);
    if (existing) return existing;
    const { data, error } = await dbClient
      .from("profiles")
      .upsert({ id: userId, email, full_name: fullName ?? null }, { onConflict: "id" })
      .select()
      .single();
    if (error) throw dbError("create profile", error);
    return data as ProfileRow;
  },

  async updateProfile(
    userId: string,
    patch: Partial<Pick<ProfileRow, "full_name" | "avatar_url" | "default_org_id" | "notification_prefs" | "email">>
  ): Promise<ProfileRow> {
    const { data, error } = await dbClient.from("profiles").update(patch).eq("id", userId).select().single();
    if (error) throw dbError("update profile", error);
    return data as ProfileRow;
  },

  async findProfileByEmail(email: string): Promise<ProfileRow | null> {
    const { data, error } = await dbClient.from("profiles").select("*").ilike("email", email).limit(1);
    if (error) throw dbError("find profile", error);
    return (data?.[0] as ProfileRow) ?? null;
  },

  /** Active members (plus pending invitees with includePending). */
  async listMembers(orgId: string, options: { includePending?: boolean } = {}): Promise<MemberRow[]> {
    let query = dbClient.from("org_members").select("org_id, user_id, role, status, invitation_id, created_at").eq("org_id", orgId);
    if (!options.includePending) query = query.eq("status", "active");
    const { data: members, error } = await query.order("created_at", { ascending: true });
    if (error) throw dbError("list members", error);
    const ids = (members || []).map((m) => m.user_id);
    if (ids.length === 0) return [];
    const { data: profiles, error: profileError } = await dbClient
      .from("profiles")
      .select("id, email, full_name, avatar_url")
      .in("id", ids);
    if (profileError) throw dbError("list member profiles", profileError);
    const byId = new Map((profiles || []).map((p) => [p.id, p]));
    return (members || []).map((m: any) => ({ ...m, profile: byId.get(m.user_id) ?? null }));
  },

  /** Adds (or activates) an active membership. */
  async addMember(orgId: string, userId: string, role: OrgRole, invitationId: string | null = null) {
    const { error } = await dbClient.from("org_members").upsert(
      {
        org_id: orgId,
        user_id: userId,
        role,
        status: "active",
        requires_acceptance: false,
        accepted_at: new Date().toISOString(),
        ...(invitationId ? { invitation_id: invitationId } : {}),
      },
      { onConflict: "org_id,user_id" }
    );
    if (error) throw dbError("add member", error);
  },

  /** Pending membership for an existing account; it only becomes active when the user accepts. */
  async addPendingMember(orgId: string, userId: string, role: OrgRole, invitationId: string) {
    const { error } = await dbClient.from("org_members").insert({
      org_id: orgId,
      user_id: userId,
      role,
      status: "pending",
      requires_acceptance: true,
      invitation_id: invitationId,
    });
    if (error) throw dbError("add pending member", error);
  },

  /** Removes pending memberships created from an invitation (when it is revoked). */
  async removePendingMembersForInvitation(orgId: string, invitationId: string): Promise<string[]> {
    const { data, error } = await dbClient
      .from("org_members")
      .delete()
      .eq("org_id", orgId)
      .eq("invitation_id", invitationId)
      .eq("status", "pending")
      .select("user_id");
    if (error) throw dbError("remove pending members", error);
    return (data || []).map((r: any) => r.user_id as string);
  },

  async updateMemberRole(orgId: string, userId: string, role: OrgRole): Promise<boolean> {
    const { data, error } = await dbClient
      .from("org_members")
      .update({ role })
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .select("user_id");
    if (error) throw dbError("update member role", error);
    return (data || []).length > 0;
  },

  async removeMember(orgId: string, userId: string): Promise<boolean> {
    const { data, error } = await dbClient
      .from("org_members")
      .delete()
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .select("user_id");
    if (error) throw dbError("remove member", error);
    return (data || []).length > 0;
  },

  async countAdmins(orgId: string): Promise<number> {
    const { count, error } = await dbClient
      .from("org_members")
      .select("user_id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("role", "admin")
      .eq("status", "active");
    if (error) throw dbError("count admins", error);
    return count ?? 0;
  },

  async listInvitations(orgId: string): Promise<InvitationRow[]> {
    const { data, error } = await dbClient
      .from("invitations")
      .select("*")
      .eq("org_id", orgId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (error) throw dbError("list invitations", error);
    return (data || []) as InvitationRow[];
  },

  /** Replaces any pending invitation for the same email. */
  async createInvitation(orgId: string, email: string, role: OrgRole, invitedBy: string): Promise<InvitationRow> {
    await dbClient
      .from("invitations")
      .update({ status: "revoked" })
      .eq("org_id", orgId)
      .eq("status", "pending")
      .ilike("email", email);
    const { data, error } = await dbClient
      .from("invitations")
      .insert({ org_id: orgId, email: email.toLowerCase(), role, invited_by: invitedBy })
      .select()
      .single();
    if (error) {
      if (error.code === UNIQUE_VIOLATION) throw dbError("create invitation (already pending)", error);
      throw dbError("create invitation", error);
    }
    return data as InvitationRow;
  },

  async setInvitationStatus(orgId: string, invitationId: string, status: InvitationRow["status"]): Promise<boolean> {
    const { data, error } = await dbClient
      .from("invitations")
      .update({ status, accepted_at: status === "accepted" ? new Date().toISOString() : null })
      .eq("org_id", orgId)
      .eq("id", invitationId)
      .select("id");
    if (error) throw dbError("update invitation", error);
    return (data || []).length > 0;
  },

  async getInvitation(orgId: string, invitationId: string): Promise<InvitationRow | null> {
    const { data, error } = await dbClient.from("invitations").select("*").eq("org_id", orgId).eq("id", invitationId).maybeSingle();
    if (error) throw dbError("get invitation", error);
    return data as InvitationRow | null;
  },

  /** Pushes a pending invitation's expiry out by `days` (resend). */
  async extendInvitation(orgId: string, invitationId: string, days = 14): Promise<InvitationRow | null> {
    const { data, error } = await dbClient
      .from("invitations")
      .update({ expires_at: new Date(Date.now() + days * 86_400_000).toISOString() })
      .eq("org_id", orgId)
      .eq("id", invitationId)
      .eq("status", "pending")
      .select()
      .maybeSingle();
    if (error) throw dbError("extend invitation", error);
    return data as InvitationRow | null;
  },

  async getPendingInvitationByToken(token: string): Promise<InvitationRow | null> {
    const { data, error } = await dbClient
      .from("invitations")
      .select("*")
      .eq("token", token)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (error) throw dbError("get invitation", error);
    return data as InvitationRow | null;
  },
};
