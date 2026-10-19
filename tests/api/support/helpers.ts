import request from "supertest";
import { inject } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { app } from "../../../apps/api/src/app";
import type { DbContext, TestUser, TestUserKey } from "./context";

export { app };

export const dbContext = (): DbContext => inject("db");
export const hasDb = (): boolean => dbContext().ok;

type Ready = Extract<DbContext, { ok: true }>;

function ready(): Ready {
  const ctx = dbContext();
  if (!ctx.ok) throw new Error(`API DB tests are blocked: ${ctx.reason}`);
  return ctx;
}

export const user = (key: TestUserKey): TestUser => ready().users[key];
export const runId = (): string => ready().runId;

let admin: SupabaseClient | null = null;
/** Service-role client for seeding and asserting rows directly. */
export function adminDb(): SupabaseClient {
  const ctx = ready();
  admin ??= createClient(ctx.url, ctx.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

type Method = "get" | "post" | "put" | "patch" | "delete";

/** Supertest calls authenticated as a test user. */
export function as(key: TestUserKey, headers: Record<string, string> = {}) {
  const u = user(key);
  const call = (method: Method, url: string) => {
    let req = request(app)[method](url).set("Authorization", `Bearer ${u.token}`);
    for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
    return req;
  };
  return {
    get: (url: string) => call("get", url),
    post: (url: string, body?: object) => call("post", url).send(body ?? {}),
    put: (url: string, body?: object) => call("put", url).send(body ?? {}),
    patch: (url: string, body?: object) => call("patch", url).send(body ?? {}),
    delete: (url: string) => call("delete", url),
  };
}

export const anonymous = () => request(app);

/** Polls until `fn` returns a truthy value (event handlers run after the response is sent). */
export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, { timeoutMs = 15_000, intervalMs = 250 } = {}): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value as T;
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms${last ? `: ${(last as Error).message}` : ""}`);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Asserts the standard API error body and returns it. */
export function errorBody(res: request.Response): { code: string; message: string; fields?: Record<string, string[]> } {
  const err = res.body?.error;
  if (!err || typeof err !== "object" || typeof err.message !== "string" || typeof err.code !== "string") {
    throw new Error(`Expected {error:{code,message}} but got ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
  }
  return err;
}

let seq = 0;
// Each test file gets a fresh module instance, so the counter alone would repeat across files.
const fileTag = Math.random().toString(36).slice(2, 7);
/** Unique, recognisable lead input for this run. */
export function leadInput(overrides: Record<string, unknown> = {}) {
  seq += 1;
  const tag = `${runId()}-${fileTag}${seq}`;
  return { name: `QA Lead ${tag}`, company: `QA Co ${tag}`, email: `lead-${tag}@example.com`, ...overrides };
}
