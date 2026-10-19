import { z } from "zod";
import { leadsDb, type LeadRow } from "@ai-lead-gen/database";
import { createRouter } from "../http/router";
import { parse } from "../http/validate";
import { rateLimit } from "../http/rateLimit";
import { getCtx } from "../middleware/auth";
import { parseLeadListQuery } from "./leads";

/** Mounted at /api/exports behind requireAuth(); file downloads for the web app. */
export const exportsRouter = createRouter();

export const MAX_EXPORT_ROWS = 10_000;
/** PostgREST returns at most 1,000 rows per request by default. */
const READ_CHUNK = 1000;
/** Keeps `id=in.(...)` filters well under URL length limits. */
const ID_CHUNK = 200;

const exportLimit = rateLimit({ name: "export", windowMs: 60_000, max: 10 });

type Cell = string | number | boolean | null | undefined;

const escapeCell = (value: Cell): string => {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const toCsv = (header: string[], rows: Cell[][]): string =>
  [header, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n");

const contactValue = (value: unknown): string => (typeof value === "string" && value !== "Not available" ? value : "");

const SOURCE_PLATFORM_LABEL: Record<string, string> = { meta: "Meta (IG/FB)", google: "Google Ads" };

/** Same columns and formatting as the web app's leadsToCsv (apps/web/src/lib/csv.ts). */
export function leadRowsToCsv(rows: LeadRow[]): string {
  return toCsv(
    ["Name", "Title", "Company", "Industry", "Email", "Phone", "Location", "Score", "Status", "Source", "Campaign", "Course interest", "Exam year", "Created at"],
    rows.map((r) => [
      r.name ?? "Unknown",
      r.title ?? "",
      r.company ?? "",
      r.industry ?? "",
      contactValue(r.email),
      contactValue(r.phone ?? r.phone_number),
      r.location ?? "",
      Number(r.score ?? 0),
      r.status ?? "New",
      SOURCE_PLATFORM_LABEL[r.source_platform as string] ?? (r.source == null ? "AI Search Discovery" : r.source.trim() || "Other"),
      r.campaign_name,
      r.course_interest,
      r.exam_year != null ? String(r.exam_year) : null,
      r.created_at,
    ])
  );
}

const exportSchema = z
  .object({
    /** Export exactly these leads (in this order); ids from other workspaces are ignored. */
    ids: z.array(z.string().uuid()).min(1).max(MAX_EXPORT_ROWS).optional(),
    /** Otherwise: the same query parameters as GET /api/leads (filters, q, sort). */
    params: z.record(z.union([z.string(), z.number()])).optional(),
  })
  .strict();

async function leadsByIds(orgId: string, ids: string[]): Promise<LeadRow[]> {
  const unique = Array.from(new Set(ids));
  const byId = new Map<string, LeadRow>();
  for (let i = 0; i < unique.length; i += ID_CHUNK) {
    for (const row of await leadsDb.getMany(orgId, unique.slice(i, i + ID_CHUNK))) byId.set(row.id, row);
  }
  return unique.map((id) => byId.get(id)).filter((row): row is LeadRow => Boolean(row));
}

// POST /api/exports/leads — { ids } or { params } -> text/csv (UTF-8 with BOM), at most MAX_EXPORT_ROWS rows
exportsRouter.post("/leads", exportLimit, async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const body = parse(exportSchema, req.body);

  let rows: LeadRow[];
  if (body.ids) {
    rows = await leadsByIds(orgId, body.ids);
  } else {
    const params = Object.fromEntries(
      Object.entries(body.params ?? {})
        .filter(([key]) => key !== "page" && key !== "pageSize")
        .map(([key, value]) => [key, String(value)])
    );
    const { pagination, filters } = parseLeadListQuery(params, userId);
    rows = [];
    for (let from = 0; from < MAX_EXPORT_ROWS; from += READ_CHUNK) {
      const to = Math.min(from + READ_CHUNK, MAX_EXPORT_ROWS) - 1;
      const page = await leadsDb.list(orgId, filters, { from, to, sort: pagination.sort });
      rows.push(...page.rows);
      if (page.rows.length < to - from + 1) break;
    }
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.setHeader("Cache-Control", "no-store");
  // Leading BOM so Excel opens UTF-8 names correctly.
  res.send(`\uFEFF${leadRowsToCsv(rows)}`);
});
