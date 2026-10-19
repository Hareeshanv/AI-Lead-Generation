import crypto from "crypto";
import { z } from "zod";
import type { CampaignLeadRow } from "@ai-lead-gen/database";
import type { WhatsAppTemplate } from "../../../../services/messaging";

/** Stored in campaign_steps.whatsapp_template. bodyParams fill {{1}}, {{2}}, ... of the template body. */
export const whatsappTemplateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Template name is required")
      .max(512)
      .regex(/^[a-z0-9_]+$/, "Use the approved template name (lowercase letters, numbers, underscores)"),
    language: z.string().trim().min(2, "Language is required").max(15),
    bodyParams: z.array(z.string().max(1000)).max(20).optional(),
    components: z.array(z.record(z.unknown())).max(10).optional(),
  })
  .strict();

export type StepWhatsAppTemplate = z.output<typeof whatsappTemplateSchema>;

type TemplateLead = Partial<Pick<CampaignLeadRow, "name" | "title" | "company" | "email" | "phone" | "location" | "course_interest">>;

function firstName(name: string | null | undefined): string {
  return (name || "").trim().split(/\s+/)[0] || "";
}

/** Placeholder values; unknown placeholders render empty. */
export function templateVariables(lead: TemplateLead): Record<string, string> {
  const clean = (v: string | null | undefined) => (v && v !== "Not available" ? v.trim() : "");
  return {
    name: clean(lead.name),
    first_name: firstName(clean(lead.name)),
    title: clean(lead.title),
    company: clean(lead.company),
    email: clean(lead.email),
    phone: clean(lead.phone),
    location: clean(lead.location),
    city: clean(lead.location),
    course: clean(lead.course_interest),
  };
}

/** Replaces {{variable}} and {{variable|fallback}} (case-insensitive, spaces allowed). */
export function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z_]+)\s*(?:\|([^}]*))?\}\}/g, (_m, key: string, fallback?: string) => {
    const value = vars[key.toLowerCase()];
    return value ? value : (fallback ?? "").trim();
  });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function linkify(escaped: string): string {
  return escaped.replace(
    /\bhttps?:\/\/(?:(?!&(?:quot|#39|lt|gt);)[^\s<])*(?!&(?:quot|#39|lt|gt);)[^\s<.,;:!?)]/g,
    (url) => `<a href="${url}">${url}</a>`
  );
}

/** Plain-text body to simple HTML paragraphs, plus an unsubscribe footer. */
export function buildEmailBodies(text: string, unsubscribeUrl: string): { html: string; text: string } {
  const paragraphs = text
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${linkify(escapeHtml(p)).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const footer =
    `<p style="margin:24px 0 0;font-size:12px;color:#888">` +
    `Don't want these emails? <a href="${escapeHtml(unsubscribeUrl)}" style="color:#888">Unsubscribe</a>.</p>`;
  return {
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">${paragraphs}${footer}</div>`,
    text: `${text.trim()}\n\n--\nUnsubscribe: ${unsubscribeUrl}`,
  };
}

function renderDeep(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === "string") return renderTemplate(value, vars);
  if (Array.isArray(value)) return value.map((v) => renderDeep(v, vars));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderDeep(v, vars)]));
  }
  return value;
}

/** Cloud API template payload for one lead. Raw components win over bodyParams. */
export function buildWhatsAppTemplate(template: StepWhatsAppTemplate, vars: Record<string, string>): WhatsAppTemplate {
  let components: unknown[] | undefined;
  if (template.components?.length) components = renderDeep(template.components, vars) as unknown[];
  else if (template.bodyParams?.length) {
    components = [
      {
        type: "body",
        parameters: template.bodyParams.map((p) => ({ type: "text", text: renderTemplate(p, vars) || "-" })),
      },
    ];
  }
  return { name: template.name, language: template.language, components };
}

// ---- Unsubscribe links ----

export const UNSUBSCRIBE_SECRET_MISSING =
  "Email campaigns are disabled until the server sets CAMPAIGN_UNSUBSCRIBE_SECRET (used to sign unsubscribe links).";

export function unsubscribeConfigured(): boolean {
  return Boolean(process.env.CAMPAIGN_UNSUBSCRIBE_SECRET);
}

function unsubscribeSecret(): string {
  const secret = process.env.CAMPAIGN_UNSUBSCRIBE_SECRET || "";
  if (!secret) throw new Error("Set CAMPAIGN_UNSUBSCRIBE_SECRET to sign unsubscribe links.");
  return secret;
}

function sign(messageId: string): string {
  return crypto.createHmac("sha256", unsubscribeSecret()).update(`unsubscribe:${messageId}`).digest("base64url").slice(0, 32);
}

export function unsubscribeToken(messageId: string): string {
  return `${messageId}.${sign(messageId)}`;
}

/** The message id, or null when the token was not issued by this server. */
export function verifyUnsubscribeToken(token: string): string | null {
  const [messageId, signature] = String(token || "").split(".");
  if (!messageId || !signature || !/^[0-9a-f-]{36}$/i.test(messageId)) return null;
  let expected: string;
  try {
    expected = sign(messageId);
  } catch {
    return null;
  }
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? messageId : null;
}

export function publicApiUrl(): string {
  return (process.env.API_PUBLIC_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/+$/, "");
}

export function unsubscribeUrl(messageId: string): string {
  return `${publicApiUrl()}/api/webhooks/unsubscribe/${unsubscribeToken(messageId)}`;
}

/** Inbound WhatsApp texts that opt the sender out. */
export function isOptOutText(text: string | null | undefined): boolean {
  return /^\s*(stop|unsubscribe|opt[\s-]?out|cancel|end|quit)\s*[.!]*\s*$/i.test(text || "");
}
