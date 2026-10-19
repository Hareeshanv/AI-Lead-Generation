import { z } from "zod";
import { dbClient, orgsDb } from "@ai-lead-gen/database";
import { createRouter } from "../http/router";
import { HttpError } from "../http/errors";
import { send } from "../http/pagination";
import { parse, parseId } from "../http/validate";
import { rateLimit } from "../http/rateLimit";
import { getCtx, invalidateMembershipCache, requireRole } from "../middleware/auth";
import { toInvitationDto, toMemberDto, webAppUrl } from "../services/account";
import { events } from "../events";

const roleSchema = z.enum(["admin", "manager", "member"]);

/** Mounted at /api/members behind requireAuth(). */
export const membersRouter = createRouter();

const inviteRedirect = () => `${webAppUrl()}/reset-password?invited=1`;

/**
 * Sends (or re-sends) the Supabase invite email. An invited account that already exists gets a
 * password-setup (recovery) email instead, which lands on the same page.
 */
async function sendInviteEmail(email: string, orgId: string): Promise<string | null> {
  const invite = await dbClient.auth.admin.inviteUserByEmail(email, {
    redirectTo: inviteRedirect(),
    data: { invited_org_id: orgId },
  });
  if (!invite.error) return null;
  if (!/already|registered|exists/i.test(invite.error.message)) return invite.error.message;
  const { error } = await dbClient.auth.resetPasswordForEmail(email, { redirectTo: inviteRedirect() });
  return error ? error.message : null;
}

/**
 * Existing accounts are never added directly: they get a sign-in link to the accept page and
 * join only after accepting (the invitation also shows up under GET /api/me/invitations).
 */
async function sendAcceptEmail(email: string, token: string): Promise<string | null> {
  const { error } = await dbClient.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${webAppUrl()}/invitations/accept?token=${encodeURIComponent(token)}`,
    },
  });
  return error ? error.message : null;
}

function inviteOutcome(emailError: string | null) {
  return { outcome: emailError ? "pending_email_failed" : "invited", ...(emailError ? { emailError } : {}) };
}

// GET /api/members — active members plus pending invitees (status "pending")
membersRouter.get("/", async (req, res) => {
  const { orgId } = getCtx(req);
  send(res, (await orgsDb.listMembers(orgId, { includePending: true })).map(toMemberDto));
});

// PATCH /api/members/:userId (admin) — change role (also for pending invitees)
membersRouter.patch("/:userId", requireRole("admin"), async (req, res) => {
  const { orgId, userId: actorId } = getCtx(req);
  const userId = parseId(req.params.userId, "user id");
  const { role } = parse(z.object({ role: roleSchema }).strict(), req.body);

  const current = await orgsDb.getMembership(orgId, userId, { includePending: true });
  if (!current) throw HttpError.notFound("Member");
  if (current.status === "active" && current.role === "admin" && role !== "admin" && (await orgsDb.countAdmins(orgId)) <= 1) {
    throw HttpError.conflict("A workspace needs at least one admin. Make someone else an admin first.");
  }
  await orgsDb.updateMemberRole(orgId, userId, role);
  invalidateMembershipCache(userId);
  if (current.role !== role) events.emit("member.role_changed", { orgId, actorId, userId, from: current.role, to: role });

  const member = (await orgsDb.listMembers(orgId, { includePending: true })).find((m) => m.user_id === userId);
  send(res, member ? toMemberDto(member) : null);
});

// POST /api/members/:userId/resend-invite (admin) — pending invitees only; extends the invitation
membersRouter.post(
  "/:userId/resend-invite",
  requireRole("admin"),
  rateLimit({ name: "invite-resend", windowMs: 60 * 60 * 1000, max: 30 }),
  async (req, res) => {
    const { orgId } = getCtx(req);
    const userId = parseId(req.params.userId, "user id");
    const current = await orgsDb.getMembership(orgId, userId, { includePending: true });
    if (!current) throw HttpError.notFound("Member");
    if (current.status !== "pending") throw HttpError.conflict("This member has already accepted the invitation.");

    const member = (await orgsDb.listMembers(orgId, { includePending: true })).find((m) => m.user_id === userId);
    const email = member?.profile?.email;
    if (!email) throw HttpError.conflict("This invitee has no email address on file.");
    const invitation = current.invitation_id ? await orgsDb.extendInvitation(orgId, current.invitation_id) : null;

    if (current.requires_acceptance) {
      if (!invitation) throw HttpError.conflict("This invitation is no longer pending. Remove the invitee and invite them again.");
      return send(res, inviteOutcome(await sendAcceptEmail(email, invitation.token)));
    }
    send(res, inviteOutcome(await sendInviteEmail(email, orgId)));
  }
);

// DELETE /api/members/:userId — admins remove anyone (revokes a pending invite); any member may leave
membersRouter.delete("/:userId", async (req, res) => {
  const { orgId, userId: actorId, role: actorRole } = getCtx(req);
  const userId = parseId(req.params.userId, "user id");
  if (userId !== actorId && actorRole !== "admin") throw HttpError.forbidden("Only admins can remove members.");

  const current = await orgsDb.getMembership(orgId, userId, { includePending: true });
  if (!current) throw HttpError.notFound("Member");
  if (current.status === "active" && current.role === "admin" && (await orgsDb.countAdmins(orgId)) <= 1) {
    throw HttpError.conflict("A workspace needs at least one admin. Make someone else an admin first.");
  }
  await orgsDb.removeMember(orgId, userId);
  if (current.status === "pending" && current.invitation_id) {
    await orgsDb.setInvitationStatus(orgId, current.invitation_id, "revoked");
  }
  invalidateMembershipCache(userId);
  events.emit("member.removed", { orgId, actorId, userId });
  res.status(204).end();
});

/** Mounted at /api/invitations behind requireAuth(); admin only. */
export const invitationsRouter = createRouter();

invitationsRouter.use(requireRole("admin"));

// GET /api/invitations — pending invitations without an account yet (invitees with an account are pending members)
invitationsRouter.get("/", async (req, res) => {
  const { orgId } = getCtx(req);
  const [invitations, members] = await Promise.all([orgsDb.listInvitations(orgId), orgsDb.listMembers(orgId, { includePending: true })]);
  const linked = new Set(members.map((m) => m.invitation_id).filter(Boolean));
  send(res, invitations.filter((i) => !linked.has(i.id)).map(toInvitationDto));
});

const inviteSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("Enter a valid email address"),
    role: roleSchema.default("member"),
  })
  .strict();

// POST /api/invitations — every invitee shows up as a pending member until they accept. New emails get a
// Supabase invite email; existing accounts get a link to accept. The response is the same either way so
// it does not reveal whether the email has an account.
invitationsRouter.post(
  "/",
  rateLimit({ name: "invite", windowMs: 60 * 60 * 1000, max: 50 }),
  async (req, res) => {
    const { orgId, userId } = getCtx(req);
    const { email, role } = parse(inviteSchema, req.body);

    const existingProfile = await orgsDb.findProfileByEmail(email);
    const existingMembership = existingProfile ? await orgsDb.getMembership(orgId, existingProfile.id, { includePending: true }) : null;
    if (existingMembership?.status === "active") throw HttpError.conflict(`${email} is already a member of this workspace.`);
    if (existingMembership?.status === "pending") {
      throw HttpError.conflict(`${email} has already been invited. Use "Resend invite" on the members list.`);
    }

    const invitation = await orgsDb.createInvitation(orgId, email, role, userId);
    events.emit("member.invited", { orgId, actorId: userId, email, role, invitationId: invitation.id });

    if (existingProfile) await orgsDb.addPendingMember(orgId, existingProfile.id, role, invitation.id);
    const emailError = existingProfile
      ? await sendAcceptEmail(email, invitation.token)
      : await sendInviteEmail(email, orgId);
    send(res, { invitation: toInvitationDto(invitation), ...inviteOutcome(emailError) }, 201);
  }
);

// DELETE /api/invitations/:id — revoke (also removes the pending membership created by the invite)
invitationsRouter.delete("/:id", async (req, res) => {
  const { orgId } = getCtx(req);
  const id = parseId(req.params.id, "invitation id");
  const invitation = await orgsDb.getInvitation(orgId, id);
  if (!invitation) throw HttpError.notFound("Invitation");
  await orgsDb.setInvitationStatus(orgId, id, "revoked");
  for (const removed of await orgsDb.removePendingMembersForInvitation(orgId, id)) invalidateMembershipCache(removed);
  res.status(204).end();
});
