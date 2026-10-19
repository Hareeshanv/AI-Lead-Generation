import { getSupabase } from "@/lib/supabase/client";

const ACTIVE_ORG_KEY = "leadgen.activeOrgId";

/** Only same-site relative paths are allowed as post-auth redirects. */
export function safeNextPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

export function getActiveOrgId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACTIVE_ORG_KEY);
}

export function setActiveOrgId(orgId: string | null): void {
  if (typeof window === "undefined") return;
  if (orgId) window.localStorage.setItem(ACTIVE_ORG_KEY, orgId);
  else window.localStorage.removeItem(ACTIVE_ORG_KEY);
}

/** Makes `orgId` the active workspace and reloads so no cached data from the previous one survives. */
export function switchWorkspace(orgId: string, path = "/dashboard"): void {
  setActiveOrgId(orgId);
  window.location.assign(path);
}

/** Signs out and hard-navigates so every cached query and store is dropped. */
export async function signOut(): Promise<void> {
  try {
    await getSupabase().auth.signOut();
  } finally {
    setActiveOrgId(null);
    window.location.assign("/login?manual=1");
  }
}

/** Maps Supabase auth errors to messages a user can act on. */
export function authErrorMessage(error: { message?: string; code?: string } | null | undefined, fallback: string): string {
  const message = error?.message || "";
  if (/invalid login credentials/i.test(message)) return "Incorrect email or password.";
  if (/email not confirmed/i.test(message)) return "Confirm your email address first — check your inbox for the link.";
  if (/user already registered/i.test(message)) return "An account with this email already exists. Sign in instead.";
  if (/password should be at least/i.test(message)) return "Password must be at least 8 characters.";
  if (/same.*password|different from the old/i.test(message)) return "Choose a password different from your current one.";
  if (/rate limit|too many/i.test(message)) return "Too many attempts. Wait a minute and try again.";
  return message || fallback;
}
