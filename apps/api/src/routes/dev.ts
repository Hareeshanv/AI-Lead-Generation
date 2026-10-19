import type { Request } from "express";
import { dbClient } from "@ai-lead-gen/database";
import { createRouter } from "../http/router";
import { HttpError } from "../http/errors";

/** Pre-auth data lives here (migration 0009); the dev user is its admin so existing data is visible. */
const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";

/** Development only: never mounted unless NODE_ENV is not production and DEV_AUTO_LOGIN=true. */
export function isDevAutoLoginEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.DEV_AUTO_LOGIN === "true";
}

export const devRouter = createRouter();

const internalError = (message: string) => new HttpError(500, "INTERNAL", message);

function isLoopback(req: Request): boolean {
  const ip = req.socket.remoteAddress || "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

async function findUserId(email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await dbClient.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw internalError(`Could not list users: ${error.message}`);
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match) return match.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

/** Ensures the dev user exists as an active admin of the Default Workspace and returns a real Supabase session. */
devRouter.post("/session", async (req, res) => {
  if (!isLoopback(req)) throw HttpError.forbidden("Dev auto-login only accepts requests from this machine.");

  const email = (process.env.DEV_LOGIN_EMAIL || "dev@leadgen.local").trim().toLowerCase();
  const password = process.env.DEV_LOGIN_PASSWORD || "";
  if (password.length < 8) throw HttpError.badRequest("Set DEV_LOGIN_PASSWORD (8+ characters) in the root .env.");

  let userId = await findUserId(email);
  if (userId) {
    const { error } = await dbClient.auth.admin.updateUserById(userId, { password, email_confirm: true });
    if (error) throw internalError(`Could not update the dev user: ${error.message}`);
  } else {
    const { data, error } = await dbClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "Dev Admin" },
    });
    if (error || !data.user) throw internalError(`Could not create the dev user: ${error?.message}`);
    userId = data.user.id;
  }

  const { error: memberError } = await dbClient
    .from("org_members")
    .upsert({ org_id: DEFAULT_ORG_ID, user_id: userId, role: "admin", status: "active" }, { onConflict: "org_id,user_id" });
  if (memberError) throw internalError(`Could not add the dev user to the Default Workspace: ${memberError.message}`);
  await dbClient.from("profiles").update({ default_org_id: DEFAULT_ORG_ID }).eq("id", userId);

  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
  const tokenRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const session = (await tokenRes.json()) as { access_token?: string; refresh_token?: string; error_description?: string; msg?: string };
  if (!tokenRes.ok || !session.access_token || !session.refresh_token) {
    throw internalError(`Dev sign-in failed: ${session.error_description || session.msg || tokenRes.status}`);
  }

  res.json({ data: { email, orgId: DEFAULT_ORG_ID, accessToken: session.access_token, refreshToken: session.refresh_token } });
});
