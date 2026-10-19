import fs from "node:fs";
import path from "node:path";
import { expect, test as base, type APIRequestContext, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { API_URL, e2eTarget } from "./target";

export const FIXTURES_FILE = path.join(__dirname, "..", ".auth", "fixtures.json");
export const PASSWORD = "Qa-E2E-Password-123!";

export type E2EUserKey = "admin" | "member";
export interface E2EUser {
  id: string;
  email: string;
  orgId: string;
}
export interface E2EFixtures {
  runId: string;
  users: Record<E2EUserKey, E2EUser>;
}

export function loadFixtures(): E2EFixtures {
  return JSON.parse(fs.readFileSync(FIXTURES_FILE, "utf8"));
}

export function adminDb(): SupabaseClient {
  const t = e2eTarget();
  return createClient(t.url, t.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

const tokens = new Map<string, string>();
export async function accessToken(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const t = e2eTarget();
  const client = createClient(t.url, t.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session) throw new Error(`E2E sign-in failed: ${error?.message}`);
  tokens.set(email, data.session.access_token);
  return data.session.access_token;
}

type Method = "get" | "post" | "patch" | "put" | "delete";

/** Calls the API as a fixture user and returns the whole JSON body ({ data, meta? }). */
export async function apiBody(request: APIRequestContext, key: E2EUserKey, method: Method, url: string, data?: unknown) {
  const user = loadFixtures().users[key];
  const res = await request[method](`${API_URL}${url}`, {
    headers: { Authorization: `Bearer ${await accessToken(user.email)}` },
    data,
  });
  const body = res.status() === 204 ? null : await res.json().catch(() => null);
  if (!res.ok()) throw new Error(`${method.toUpperCase()} ${url} -> ${res.status()} ${JSON.stringify(body)}`);
  return body;
}

/** Calls the API as a fixture user (for seeding data the UI then shows) and returns `data`. */
export async function api(request: APIRequestContext, key: E2EUserKey, method: Method, url: string, data?: unknown) {
  const body = await apiBody(request, key, method, url, data);
  return body?.data ?? body;
}

export async function signIn(page: Page, key: E2EUserKey, next = "/dashboard") {
  const user = loadFixtures().users[key];
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname + url.search === next, { timeout: 30_000 });
}

/** Fails the test on uncaught page errors and on 5xx API responses. */
export const test = base.extend<{ watchErrors: string[] }>({
  watchErrors: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
      page.on("response", (res) => {
        if (res.url().startsWith(API_URL) && res.status() >= 500) problems.push(`${res.status()} ${res.request().method()} ${res.url()}`);
      });
      await use(problems);
      expect(problems, "page errors / API 5xx during the test").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

let seq = 0;
export function unique(label: string): string {
  seq += 1;
  return `${label} ${loadFixtures().runId}-${Date.now().toString(36)}${seq}`;
}
