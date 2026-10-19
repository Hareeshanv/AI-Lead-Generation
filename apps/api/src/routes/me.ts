import { z } from "zod";
import { orgsDb } from "@ai-lead-gen/database";
import { createRouter } from "../http/router";
import { HttpError } from "../http/errors";
import { send } from "../http/pagination";
import { parse } from "../http/validate";
import { getCtx, invalidateMembershipCache } from "../middleware/auth";
import { loadAccount, NOTIFICATION_PREF_KEYS, notificationPrefs } from "../services/account";
import { events } from "../events";

/** Mounted at /api/me with auth "user": signed in, workspace membership optional. */
export const meRouter = createRouter();

function authUser(req: Parameters<typeof getCtx>[0]) {
  if (!req.authUser) throw HttpError.unauthorized();
  return req.authUser;
}

/** Activates the caller's pending invitations; returns the org ids joined. */
async function acceptPendingInvitations(userId: string): Promise<string[]> {
  const joined = await orgsDb.acceptPendingMemberships(userId);
  if (joined.length === 0) return [];
  invalidateMembershipCache(userId);
  for (const m of joined) events.emit("member.joined", { orgId: m.org_id, actorId: userId, userId, role: m.role });
  return joined.map((m) => m.org_id);
}

// GET /api/me — profile, active workspace + role, memberships and workspace settings.
// The first authenticated call after following an invite link accepts the pending invitation(s).
meRouter.get("/", async (req, res) => {
  const ctx = getCtx(req);
  const joined = await acceptPendingInvitations(ctx.userId);
  const account = await loadAccount(authUser(req), ctx.orgId || joined[0] || "");
  if (!ctx.orgId) invalidateMembershipCache(ctx.userId);
  send(res, account);
});

const prefsSchema = z
  .object(Object.fromEntries(NOTIFICATION_PREF_KEYS.map((k) => [k, z.boolean().optional()])) as Record<
    (typeof NOTIFICATION_PREF_KEYS)[number],
    z.ZodOptional<z.ZodBoolean>
  >)
  .strict();

const updateMeSchema = z
  .object({
    fullName: z.string().trim().min(1, "Name is required").max(120).optional(),
    avatarUrl: z.string().trim().url("Enter a valid image URL").max(1000).nullable().optional(),
    notificationPrefs: prefsSchema.optional(),
    defaultOrgId: z.string().uuid().optional(),
  })
  .strict();

// PATCH /api/me — update own profile / notification preferences / default workspace
meRouter.patch("/", async (req, res) => {
  const ctx = getCtx(req);
  const body = parse(updateMeSchema, req.body);
  const patch: Parameters<typeof orgsDb.updateProfile>[1] = {};

  if (body.fullName !== undefined) patch.full_name = body.fullName;
  if (body.avatarUrl !== undefined) patch.avatar_url = body.avatarUrl;
  if (body.notificationPrefs) {
    const current = await orgsDb.getProfile(ctx.userId);
    patch.notification_prefs = { ...notificationPrefs(current?.notification_prefs), ...body.notificationPrefs };
  }
  if (body.defaultOrgId) {
    if (!(await orgsDb.getMembership(body.defaultOrgId, ctx.userId))) {
      throw HttpError.forbidden("You are not a member of that workspace.");
    }
    patch.default_org_id = body.defaultOrgId;
    invalidateMembershipCache(ctx.userId);
  }

  await orgsDb.ensureProfile(ctx.userId, ctx.email);
  if (Object.keys(patch).length > 0) await orgsDb.updateProfile(ctx.userId, patch);
  send(res, await loadAccount(authUser(req), body.defaultOrgId || ctx.orgId));
});

// POST /api/me/invitations/accept — join a workspace with an invitation token (existing accounts)
meRouter.post("/invitations/accept", async (req, res) => {
  const ctx = getCtx(req);
  const { token } = parse(z.object({ token: z.string().min(16).max(200) }), req.body);
  const invitation = await orgsDb.getPendingInvitationByToken(token);
  if (!invitation) throw HttpError.notFound("Invitation");
  if (!ctx.email || invitation.email.toLowerCase() !== ctx.email.toLowerCase()) {
    throw HttpError.forbidden("This invitation was sent to a different email address.");
  }
  await orgsDb.addMember(invitation.org_id, ctx.userId, invitation.role, invitation.id);
  await orgsDb.setInvitationStatus(invitation.org_id, invitation.id, "accepted");
  invalidateMembershipCache(ctx.userId);
  events.emit("member.joined", { orgId: invitation.org_id, actorId: ctx.userId, userId: ctx.userId, role: invitation.role });
  send(res, await loadAccount(authUser(req), invitation.org_id));
});
