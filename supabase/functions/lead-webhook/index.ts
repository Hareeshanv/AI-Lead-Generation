// Receives lead-form submissions from Meta Lead Ads and Google Ads lead forms.
//
//   GET  ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...   Meta subscription check
//   POST (X-Hub-Signature-256)                                        Meta leadgen event
//   POST ?source=google&source_id=<lead_sources.id>                   Google Ads lead form
//
// Meta: without a query string the platform app (META_APP_SECRET / META_VERIFY_TOKEN) is used.
// A workspace with its own Meta app points the app's webhook at `?org_id=<workspace id>`; its
// stored "meta" integration secret then verifies the request and only its lead sources are used.
//
// Failures that may succeed later return 5xx so Meta / Google redeliver; saving is idempotent.
//
// verify_jwt is disabled for this function (see supabase/config.toml); requests are
// authenticated by the Meta app-secret signature or the per-source Google key instead.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { type FormAnswer, normalizeLead, type RawAdLead } from "./normalize.ts";

const GRAPH_API = "https://graph.facebook.com/v21.0";
const LOG_AGENT_ID = "agt-crm";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const supabase: SupabaseClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false, autoRefreshToken: false } },
);

interface LeadSource {
  id: string;
  org_id: string;
  academy_id: string | null;
  form_ids: string[] | null;
  webhook_key: string | null;
  status: string | null;
  academies: { name: string } | { name: string }[] | null;
}

const SOURCE_COLUMNS = "id, org_id, academy_id, form_ids, webhook_key, status, academies(name)";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function academyName(source: LeadSource): string | null {
  const academy = Array.isArray(source.academies) ? source.academies[0] : source.academies;
  return academy?.name ?? null;
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  let diff = aBytes.length ^ bBytes.length;
  const len = Math.max(aBytes.length, bBytes.length);
  for (let i = 0; i < len; i++) {
    diff |= (i < aBytes.length ? aBytes[i] : 0) ^ (i < bBytes.length ? bBytes[i] : 0);
  }
  return diff === 0;
}

async function hmacSha256Hex(secret: string, data: Uint8Array<ArrayBuffer> | string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  const sig = await crypto.subtle.sign("HMAC", key, bytes);
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function logToAgent(level: "info" | "warning" | "error", message: string): Promise<void> {
  try {
    const { error } = await supabase
      .from("agent_logs")
      .insert({ agent_id: LOG_AGENT_ID, level, message: message.slice(0, 2000) });
    if (error) console.error("agent_logs insert failed:", error.message);
  } catch (err) {
    console.error("agent_logs insert threw:", err);
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

async function saveLead(raw: RawAdLead, sourceId: string, orgId: string): Promise<void> {
  const row = { ...normalizeLead(raw), org_id: orgId };
  let { data, error } = await supabase
    .from("leads")
    .upsert(row, { onConflict: "source_platform,external_lead_id", ignoreDuplicates: true })
    .select("id");

  // The same person may already exist (scraped lead or another form) under the
  // case-insensitive email unique index. Keep the new enquiry without the email.
  if (error?.code === "23505" && row.email) {
    await logToAgent(
      "warning",
      `[lead-webhook] ${raw.platform} lead ${raw.externalLeadId}: email already on another lead; stored without email`,
    );
    ({ data, error } = await supabase
      .from("leads")
      .upsert(
        { ...row, email: null, tags: [...row.tags, "duplicate-email"], raw_answers: { ...row.raw_answers, duplicate_email: row.email } },
        { onConflict: "source_platform,external_lead_id", ignoreDuplicates: true },
      )
      .select("id"));
  }

  if (error) throw error;

  if (data && data.length > 0) {
    const { error: updateError } = await supabase
      .from("lead_sources")
      .update({ last_lead_at: new Date().toISOString() })
      .eq("id", sourceId);
    if (updateError) console.error("last_lead_at update failed:", updateError.message);
  }
}

// ---------------------------------------------------------------- Meta

/** A failure that redelivery cannot fix (e.g. the lead was deleted); logged, not retried. */
class PermanentError extends Error {}

interface MetaApp {
  appSecret: string;
  verifyToken: string | null;
  /** Set for a workspace's own app: only that workspace's lead sources are used. */
  orgId: string | null;
}

/** The platform app, or the workspace's own app for `?org_id=`; null when not configured. */
async function resolveMetaApp(url: URL): Promise<MetaApp | null> {
  const orgId = url.searchParams.get("org_id");
  if (orgId === null) {
    const appSecret = Deno.env.get("META_APP_SECRET");
    return appSecret ? { appSecret, verifyToken: Deno.env.get("META_VERIFY_TOKEN") ?? null, orgId: null } : null;
  }
  if (!UUID_RE.test(orgId)) return null;
  const { data, error } = await supabase.rpc("get_integration_secret", { p_org_id: orgId, p_provider: "meta" });
  if (error) throw error;
  if (typeof data !== "string" || !data) return null;
  try {
    const secrets = JSON.parse(data) as { appSecret?: string; verifyToken?: string };
    return secrets.appSecret ? { appSecret: secrets.appSecret, verifyToken: secrets.verifyToken || null, orgId } : null;
  } catch {
    await logToAgent("error", `[lead-webhook] Meta integration secret for workspace ${orgId} is not valid JSON`);
    return null;
  }
}

async function handleMetaVerify(url: URL): Promise<Response> {
  const verifyToken = (await resolveMetaApp(url))?.verifyToken;
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  if (mode === "subscribe" && verifyToken && timingSafeEqual(token, verifyToken)) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

interface MetaLeadgenValue {
  leadgen_id?: string;
  page_id?: string;
  form_id?: string;
  created_time?: number;
}

interface MetaGraphLead {
  id: string;
  created_time?: string;
  form_id?: string;
  ad_name?: string;
  campaign_name?: string;
  is_organic?: boolean;
  field_data?: { name: string; values?: string[] }[];
}

async function fetchMetaLead(leadgenId: string, token: string, appSecret: string): Promise<MetaGraphLead> {
  const params = new URLSearchParams({
    fields: "created_time,field_data,ad_name,campaign_name,form_id,is_organic",
    access_token: token,
    appsecret_proof: await hmacSha256Hex(appSecret, token),
  });
  const res = await fetch(`${GRAPH_API}/${encodeURIComponent(leadgenId)}?${params}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = `Graph API ${res.status}: ${body?.error?.message ?? "unknown error"}`;
    // 4xx (bad id, deleted lead, missing permission) will not change on redelivery; 429 and 5xx may.
    if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new PermanentError(message);
    throw new Error(message);
  }
  return body as MetaGraphLead;
}

async function processMetaChange(value: MetaLeadgenValue, app: MetaApp): Promise<void> {
  const leadgenId = value.leadgen_id;
  const pageId = value.page_id;
  if (!leadgenId || !pageId) {
    await logToAgent("warning", "[lead-webhook] Meta leadgen change without leadgen_id/page_id");
    return;
  }

  let query = supabase
    .from("lead_sources")
    .select(SOURCE_COLUMNS)
    .eq("platform", "meta")
    .eq("external_page_id", pageId);
  if (app.orgId) query = query.eq("org_id", app.orgId);
  const { data: source, error } = await query.maybeSingle<LeadSource>();
  if (error) throw error;
  if (!source || source.status !== "active") {
    await logToAgent("warning", `[lead-webhook] Meta lead ${leadgenId} for unconnected/inactive page ${pageId}`);
    return;
  }
  if (source.form_ids?.length && value.form_id && !source.form_ids.includes(value.form_id)) {
    return;
  }

  const { data: token, error: tokenError } = await supabase.rpc("get_lead_source_token", {
    p_source_id: source.id,
  });
  if (tokenError) throw tokenError;
  if (!token) throw new Error(`No page token in Vault for lead source ${source.id}`);

  const lead = await fetchMetaLead(leadgenId, token as string, app.appSecret);
  const answers: FormAnswer[] = (lead.field_data ?? []).map((f) => ({
    key: f.name,
    value: (f.values ?? []).join(", "),
  }));

  await saveLead({
    platform: "meta",
    externalLeadId: lead.id ?? leadgenId,
    formId: lead.form_id ?? value.form_id ?? null,
    campaignName: lead.campaign_name ?? null,
    adName: lead.ad_name ?? null,
    submittedAt: lead.created_time ??
      (value.created_time ? new Date(value.created_time * 1000).toISOString() : new Date().toISOString()),
    answers,
    isTest: false,
    academyId: source.academy_id,
    academyName: academyName(source),
    extra: { page_id: pageId, is_organic: lead.is_organic ?? null },
  }, source.id, source.org_id);
}

async function handleMetaEvent(req: Request, url: URL): Promise<Response> {
  let app: MetaApp | null;
  try {
    app = await resolveMetaApp(url);
  } catch (err) {
    await logToAgent("error", `[lead-webhook] Meta app lookup failed: ${errorMessage(err)}`);
    return json({ error: "Temporary failure" }, 503);
  }
  if (!app) {
    if (!url.searchParams.has("org_id")) await logToAgent("error", "[lead-webhook] META_APP_SECRET is not set");
    // Unknown workspace and missing configuration look the same to the caller.
    return json({ error: "Not configured" }, url.searchParams.has("org_id") ? 401 : 500);
  }

  const rawBody = new Uint8Array(await req.arrayBuffer());
  const header = req.headers.get("x-hub-signature-256") ?? "";
  const expected = `sha256=${await hmacSha256Hex(app.appSecret, rawBody)}`;
  if (!header || !timingSafeEqual(header.toLowerCase(), expected)) {
    return json({ error: "Invalid signature" }, 401);
  }

  let payload: any;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    await logToAgent("error", "[lead-webhook] Meta payload is not valid JSON");
    return json({ error: "Invalid JSON" }, 400);
  }
  if (payload?.object !== "page") return json({ received: true });

  let retryable = 0;
  for (const entry of payload.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      if (change?.field !== "leadgen") continue;
      const value: MetaLeadgenValue = { page_id: entry?.id, ...(change.value ?? {}) };
      try {
        await processMetaChange(value, app);
      } catch (err) {
        if (!(err instanceof PermanentError)) retryable++;
        await logToAgent(
          "error",
          `[lead-webhook] Meta lead ${value.leadgen_id ?? "?"} failed${err instanceof PermanentError ? "" : " (will retry)"}: ${errorMessage(err)}`,
        );
      }
    }
  }
  // Meta redelivers the whole batch; leads already saved are skipped by the upsert.
  if (retryable > 0) return json({ error: "Temporary failure" }, 500);
  return json({ received: true });
}

// ---------------------------------------------------------------- Google

interface GoogleColumn {
  column_id?: string;
  column_name?: string;
  string_value?: string;
}

interface GoogleLeadPayload {
  lead_id?: string;
  google_key?: string;
  form_id?: number | string;
  campaign_id?: number | string;
  adgroup_id?: number | string;
  creative_id?: number | string;
  gcl_id?: string;
  is_test?: boolean;
  lead_submit_time?: string;
  user_column_data?: GoogleColumn[];
}

const GOOGLE_STANDARD_COLUMNS: Record<string, string> = {
  FULL_NAME: "full_name",
  FIRST_NAME: "first_name",
  LAST_NAME: "last_name",
  EMAIL: "email",
  WORK_EMAIL: "email",
  PHONE_NUMBER: "phone_number",
  WORK_PHONE: "phone_number",
  CITY: "city",
};

async function handleGoogleEvent(req: Request, url: URL): Promise<Response> {
  const sourceId = url.searchParams.get("source_id") ?? "";
  if (!UUID_RE.test(sourceId)) return json({ error: "Invalid source_id" }, 401);

  let payload: GoogleLeadPayload;
  try {
    payload = JSON.parse(await req.text());
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { data: source, error } = await supabase
    .from("lead_sources")
    .select(SOURCE_COLUMNS)
    .eq("id", sourceId)
    .eq("platform", "google")
    .maybeSingle<LeadSource>();

  if (error) {
    await logToAgent("error", `[lead-webhook] Google source lookup failed: ${error.message}`);
    return json({ error: "Temporary failure" }, 500);
  }
  if (!source?.webhook_key || !timingSafeEqual(payload.google_key ?? "", source.webhook_key)) {
    return json({ error: "Invalid key" }, 401);
  }

  try {
    if (source.status !== "active") {
      await logToAgent("warning", `[lead-webhook] Google lead for inactive source ${source.id} ignored`);
      return json({ received: true });
    }
    if (!payload.lead_id) {
      await logToAgent("warning", `[lead-webhook] Google payload without lead_id for source ${source.id}`);
      return json({ received: true });
    }

    const answers: FormAnswer[] = (payload.user_column_data ?? []).map((col) => ({
      key: GOOGLE_STANDARD_COLUMNS[col.column_id ?? ""] ?? col.column_name ?? col.column_id ?? "",
      value: col.string_value ?? "",
    }));

    await saveLead({
      platform: "google",
      externalLeadId: payload.lead_id,
      formId: payload.form_id != null ? String(payload.form_id) : null,
      campaignName: null,
      adName: null,
      submittedAt: payload.lead_submit_time ?? new Date().toISOString(),
      answers,
      isTest: payload.is_test === true,
      academyId: source.academy_id,
      academyName: academyName(source),
      extra: {
        campaign_id: payload.campaign_id ?? null,
        adgroup_id: payload.adgroup_id ?? null,
        creative_id: payload.creative_id ?? null,
        gcl_id: payload.gcl_id ?? null,
      },
    }, source.id, source.org_id);
  } catch (err) {
    await logToAgent(
      "error",
      `[lead-webhook] Google lead ${payload.lead_id ?? "?"} failed (will retry): ${errorMessage(err)}`,
    );
    return json({ error: "Temporary failure" }, 500);
  }
  return json({ received: true });
}

// ---------------------------------------------------------------- Router

Deno.serve(async (req) => {
  const url = new URL(req.url);
  try {
    if (req.method === "GET") {
      if (url.searchParams.has("hub.mode")) return await handleMetaVerify(url);
      return json({ ok: true });
    }
    if (req.method === "POST") {
      if (url.searchParams.get("source") === "google") return await handleGoogleEvent(req, url);
      return await handleMetaEvent(req, url);
    }
    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    await logToAgent("error", `[lead-webhook] Unhandled error: ${errorMessage(err)}`);
    return json({ error: "Internal error" }, 500);
  }
});
