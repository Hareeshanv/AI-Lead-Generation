import type { NextFunction, Request, RequestHandler, Response } from "express";
import { dbClient, orgsDb, type OrgRole } from "@ai-lead-gen/database";
import { HttpError } from "../http/errors";

export type { OrgRole };

export interface AuthUser {
  id: string;
  email: string | null;
  metadata: Record<string, any>;
}

export interface RequestContext {
  userId: string;
  email: string | null;
  orgId: string;
  role: OrgRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireAuth(); orgId/role are empty only with requireAuth({ requireOrg: false }). */
      ctx?: RequestContext;
      authUser?: AuthUser;
    }
  }
}

const ROLE_RANK: Record<OrgRole, number> = { member: 1, manager: 2, admin: 3 };
const TOKEN_CACHE_MS = 60_000;
const MEMBERSHIP_CACHE_MS = 15_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const tokenCache = new Map<string, { user: AuthUser; expiresAt: number }>();
const membershipCache = new Map<string, { orgId: string; role: OrgRole; expiresAt: number }>();

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

async function verifyToken(token: string): Promise<AuthUser> {
  const now = Date.now();
  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > now) return cached.user;

  const { data, error } = await dbClient.auth.getUser(token);
  if (error || !data?.user) throw HttpError.unauthorized("Your session has expired. Please sign in again.");

  const user: AuthUser = { id: data.user.id, email: data.user.email ?? null, metadata: data.user.user_metadata || {} };
  if (tokenCache.size > 5_000) tokenCache.clear();
  tokenCache.set(token, { user, expiresAt: now + TOKEN_CACHE_MS });
  return user;
}

/** Resolves the org from x-org-id (must be a membership) or the user's default/first org. */
async function resolveMembership(userId: string, requestedOrgId: string | null): Promise<{ orgId: string; role: OrgRole } | null> {
  const cacheKey = `${userId}:${requestedOrgId || "*"}`;
  const now = Date.now();
  const cached = membershipCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return { orgId: cached.orgId, role: cached.role };

  let resolved: { orgId: string; role: OrgRole } | null = null;
  if (requestedOrgId) {
    const membership = await orgsDb.getMembership(requestedOrgId, userId);
    if (!membership) throw new HttpError(403, "NOT_A_MEMBER", "You are not a member of this workspace.");
    resolved = { orgId: requestedOrgId, role: membership.role };
  } else {
    const memberships = await orgsDb.getMemberships(userId);
    if (memberships.length > 0) {
      const profile = await orgsDb.getProfile(userId);
      const preferred = memberships.find((m) => m.org_id === profile?.default_org_id) || memberships[0];
      resolved = { orgId: preferred.org_id, role: preferred.role };
    }
  }

  if (resolved) {
    if (membershipCache.size > 5_000) membershipCache.clear();
    membershipCache.set(cacheKey, { ...resolved, expiresAt: now + MEMBERSHIP_CACHE_MS });
  }
  return resolved;
}

/** Call after changing a user's memberships so the next request sees the new role. */
export function invalidateMembershipCache(userId?: string) {
  if (!userId) return membershipCache.clear();
  for (const key of membershipCache.keys()) if (key.startsWith(`${userId}:`)) membershipCache.delete(key);
}

/**
 * Verifies the Supabase access token (Authorization: Bearer) and attaches req.ctx = { userId, orgId, role }.
 * With requireOrg: false, a signed-in user without any membership is let through with orgId "".
 */
export function requireAuth(options: { requireOrg?: boolean } = {}): RequestHandler {
  const requireOrg = options.requireOrg !== false;
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = bearerToken(req);
      if (!token) throw HttpError.unauthorized();
      const user = await verifyToken(token);
      req.authUser = user;

      const header = req.headers["x-org-id"];
      const requestedOrgId = typeof header === "string" && header.trim() ? header.trim() : null;
      if (requestedOrgId && !UUID_RE.test(requestedOrgId)) throw HttpError.badRequest("Invalid x-org-id header.");

      const membership = await resolveMembership(user.id, requestedOrgId);
      if (!membership && requireOrg) {
        throw new HttpError(403, "NO_ORGANIZATION", "You are not a member of any workspace yet.");
      }
      req.ctx = {
        userId: user.id,
        email: user.email,
        orgId: membership?.orgId ?? "",
        role: membership?.role ?? "member",
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Allows the request when the caller's role is at least the lowest of `roles` (admin > manager > member). */
export function requireRole(...roles: OrgRole[]): RequestHandler {
  const minRank = Math.min(...roles.map((r) => ROLE_RANK[r]));
  return (req, _res, next) => {
    if (!req.ctx) return next(HttpError.unauthorized());
    if (ROLE_RANK[req.ctx.role] < minRank) {
      return next(HttpError.forbidden(`This action needs the ${roles.join(" or ")} role.`));
    }
    next();
  };
}

export function hasRole(ctx: RequestContext, role: OrgRole): boolean {
  return ROLE_RANK[ctx.role] >= ROLE_RANK[role];
}

/** req.ctx for handlers mounted behind requireAuth(). */
export function getCtx(req: Request): RequestContext {
  if (!req.ctx) throw HttpError.unauthorized();
  return req.ctx;
}
