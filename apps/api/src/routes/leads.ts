import { z } from "zod";
import { activitiesDb, dbQueries, leadsDb, tasksDb, type LeadListFilters, type LeadRow } from "@ai-lead-gen/database";
import { runLeadSearch, LeadSearchError } from "../../../../services/search/leadSearch";
import { createRouter } from "../http/router";
import { HttpError } from "../http/errors";
import { parsePagination, send, sendPage } from "../http/pagination";
import { parse, parseId, queryList } from "../http/validate";
import { getCtx, hasRole, requireRole } from "../middleware/auth";
import { PermanentJobError, registerJobHandler } from "../jobs/registry";
import { events } from "../events";
import { LEAD_STATUSES } from "../services/crm/pipeline";
import { SCORING_FIELDS } from "../services/leads/scoring";
import {
  assertMember,
  diffFields,
  emitLeadChanges,
  ingestExternalLead,
  loadThresholds,
  recordStatusChange,
  rescoreAllLeads,
  rescoreLead,
  scoredFields,
  toLeadDto,
} from "../services/leads/service";
import { activityInputSchema, createActivity, createTask, taskInputSchema } from "./tasks";

/** Mounted at /api/leads behind requireAuth(); owned by the Leads module. */
export const leadsRouter = createRouter();

const MAX_BULK = 500;
const MAX_IMPORT_ROWS = 2000;

const statusSchema = z.enum(LEAD_STATUSES);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const tagsSchema = z.array(z.string().trim().min(1).max(50)).max(50);
const consentChannelSchema = z.array(z.enum(["email", "whatsapp", "sms", "call"])).max(4);

/** API field -> leads column for multi-word fields (single-word fields use the same name). */
const COLUMN: Record<string, string> = {
  ownerId: "owner_id",
  doNotContact: "do_not_contact",
  consentChannel: "consent_channel",
  companySize: "company_size",
  courseInterest: "course_interest",
  examYear: "exam_year",
  profileUrl: "profile_url",
};

const leadFields = {
  name: z.string().trim().min(1, "Name is required").max(200),
  title: optionalText(200),
  company: optionalText(200).transform((v) => v ?? ""),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(320)
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || z.string().email().safeParse(v).success, "Enter a valid email address"),
  phone: optionalText(50),
  location: optionalText(200),
  industry: optionalText(200),
  companySize: optionalText(100),
  courseInterest: optionalText(200),
  examYear: optionalText(10),
  profileUrl: optionalText(500),
  score: z.number().int().min(0).max(100),
  status: statusSchema,
  source: z.string().trim().min(1).max(100),
  tags: tagsSchema,
  ownerId: z.string().uuid().nullable(),
  doNotContact: z.boolean(),
  consentChannel: consentChannelSchema,
};

const createLeadSchema = z
  .object({
    ...leadFields,
    score: leadFields.score.optional(),
    status: leadFields.status.optional(),
    source: leadFields.source.default("Manual Entry"),
    tags: leadFields.tags.default([]),
    ownerId: leadFields.ownerId.optional(),
    doNotContact: leadFields.doNotContact.default(false),
    consentChannel: leadFields.consentChannel.default([]),
  })
  .strict();

const updateLeadSchema = z
  .object(leadFields)
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, "Nothing to update");

function toRow(body: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) if (value !== undefined) row[COLUMN[key] ?? key] = value;
  return row;
}

const listQuerySchema = z.object({
  status: queryList.optional(),
  source: queryList.optional(),
  sourcePlatform: z.string().trim().max(50).optional(),
  ownerId: z.union([z.literal("me"), z.literal("unassigned"), z.string().uuid()]).optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  maxScore: z.coerce.number().int().min(0).max(100).optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  tags: queryList.optional(),
  campaignName: z.string().trim().max(200).optional(),
  courseInterest: z.string().trim().max(200).optional(),
  examYear: z.string().trim().max(10).optional(),
});

const SORTABLE = {
  name: "name",
  company: "company",
  score: "score",
  status: "status",
  source: "source",
  createdAt: "created_at",
  updatedAt: "updated_at",
  lastContactedAt: "last_contacted_at",
};

async function getLeadOr404(orgId: string, id: string): Promise<LeadRow> {
  const lead = await leadsDb.get(orgId, id);
  if (!lead) throw HttpError.notFound("Lead");
  return lead;
}

// POST /api/leads/search — natural-language query -> filters -> stored leads + intent signals
leadsRouter.post("/search", async (req, res) => {
  const { orgId } = getCtx(req);
  const { query } = parse(z.object({ query: z.string().trim().min(1, "Enter a search query").max(500) }), req.body);
  try {
    const { filters, parsedBy, leads, signals, warnings } = await runLeadSearch(orgId, query);
    send(res, { filters, parsedBy, leads, signals, warnings });
  } catch (err: any) {
    if (err instanceof LeadSearchError) {
      throw new HttpError(500, "INTERNAL", err.message || "Lead search failed");
    }
    throw err;
  }
});

// GET /api/leads?page&pageSize&sort&q&status&source&sourcePlatform&ownerId&minScore&maxScore&createdFrom&createdTo&tags&...
leadsRouter.get("/", async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const pagination = parsePagination(req.query, { sortable: SORTABLE, defaultSort: "-createdAt" });
  const query = parse(listQuerySchema, req.query);
  const filters: LeadListFilters = {
    q: pagination.q,
    status: query.status,
    source: query.source,
    sourcePlatform: query.sourcePlatform,
    ownerId: query.ownerId === "me" ? userId : query.ownerId === "unassigned" ? null : query.ownerId,
    minScore: query.minScore,
    maxScore: query.maxScore,
    createdFrom: query.createdFrom?.toISOString(),
    createdTo: query.createdTo?.toISOString(),
    tags: query.tags,
    campaignName: query.campaignName,
    courseInterest: query.courseInterest,
    examYear: query.examYear,
  };
  const { rows, total } = await leadsDb.list(orgId, filters, pagination);
  sendPage(res, rows.map(toLeadDto), total, pagination);
});

// GET /api/leads/facets — distinct values for filter dropdowns
leadsRouter.get("/facets", async (req, res) => {
  send(res, await leadsDb.facets(getCtx(req).orgId));
});

// POST /api/leads — create one lead (whitelisted fields; scored unless a score is given)
leadsRouter.post("/", async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const body = parse(createLeadSchema, req.body);
  await assertMember(orgId, body.ownerId, "ownerId");
  const row = toRow({ ...body, ownerId: body.ownerId === undefined ? userId : body.ownerId });
  row.status = row.status ?? "New";
  const thresholds = await loadThresholds(orgId);
  const scored = scoredFields(row, thresholds, body.status !== undefined);
  if (body.score !== undefined) scored.score = body.score;
  const lead = await leadsDb.create(orgId, { ...row, ...scored });
  events.emit("lead.created", { orgId, actorId: userId, leadId: lead.id, source: lead.source, lead: toLeadDto(lead) });
  send(res, toLeadDto(lead), 201);
});

const importRowSchema = z.object({
  ...leadFields,
  score: leadFields.score.optional(),
  status: leadFields.status.optional(),
  source: leadFields.source.optional(),
  tags: leadFields.tags.optional(),
  ownerId: leadFields.ownerId.optional(),
  doNotContact: leadFields.doNotContact.optional(),
  consentChannel: leadFields.consentChannel.optional(),
});

const importSchema = z
  .object({
    rows: z.array(z.record(z.unknown())).min(1, "No rows to import").max(MAX_IMPORT_ROWS, `Import at most ${MAX_IMPORT_ROWS} rows at a time`),
    source: z.string().trim().min(1).max(100).default("CSV Import"),
    ownerId: z.string().uuid().nullable().optional(),
    tags: tagsSchema.default([]),
  })
  .strict();

// POST /api/leads/import — rows already mapped to lead fields by the client; invalid rows and duplicates are skipped
leadsRouter.post("/import", async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const body = parse(importSchema, req.body);
  await assertMember(orgId, body.ownerId, "ownerId");
  const thresholds = await loadThresholds(orgId);

  const errors: { row: number; message: string }[] = [];
  const valid: Record<string, unknown>[] = [];
  body.rows.forEach((raw, index) => {
    const cleaned = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== "" && v !== undefined));
    if (typeof cleaned.score === "string") cleaned.score = Number(cleaned.score);
    if (typeof cleaned.tags === "string") cleaned.tags = cleaned.tags.split(/[;,|]/).map((t) => t.trim()).filter(Boolean);
    const result = importRowSchema.safeParse(cleaned);
    if (!result.success) {
      const issue = result.error.issues[0];
      errors.push({ row: index + 1, message: `${issue.path.join(".") || "row"}: ${issue.message}` });
      return;
    }
    const data = result.data;
    const row = toRow({
      ...data,
      source: data.source ?? body.source,
      tags: Array.from(new Set([...(data.tags ?? []), ...body.tags])),
      ownerId: data.ownerId ?? body.ownerId ?? userId,
    });
    row.status = row.status ?? "New";
    const scored = scoredFields(row, thresholds, data.status !== undefined);
    if (data.score !== undefined) scored.score = data.score;
    valid.push({ ...row, ...scored });
  });

  const { inserted, duplicates } = valid.length > 0 ? await dbQueries.insertNewLeads(orgId, valid) : { inserted: [], duplicates: 0 };
  for (const lead of inserted) {
    events.emit("lead.created", { orgId, actorId: userId, leadId: lead.id, source: lead.source, lead: toLeadDto(lead), imported: true });
  }
  if (inserted.length > 0) {
    events.emit("lead.imported", { orgId, actorId: userId, count: inserted.length, leadIds: inserted.map((l: any) => l.id) });
  }
  send(res, { imported: inserted.length, duplicates, invalid: errors.length, errors: errors.slice(0, 100) }, 201);
});

const leadIdsSchema = z.array(z.string().uuid()).min(1, "Select at least one lead").max(MAX_BULK);

const bulkSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), leadIds: leadIdsSchema, ownerId: z.string().uuid().nullable() }).strict(),
  z.object({ action: z.literal("status"), leadIds: leadIdsSchema, status: statusSchema }).strict(),
  z.object({ action: z.literal("tag"), leadIds: leadIdsSchema, tags: tagsSchema.min(1) }).strict(),
  z.object({ action: z.literal("untag"), leadIds: leadIdsSchema, tags: tagsSchema.min(1) }).strict(),
  z.object({ action: z.literal("delete"), leadIds: leadIdsSchema }).strict(),
  z.object({ action: z.literal("rescore"), leadIds: leadIdsSchema }).strict(),
]);

// POST /api/leads/bulk — { action: assign|status|tag|untag|delete|rescore, leadIds, ... }
leadsRouter.post("/bulk", async (req, res) => {
  const ctx = getCtx(req);
  const { orgId, userId } = ctx;
  const body = parse(bulkSchema, req.body);
  const ids = Array.from(new Set(body.leadIds));

  if (body.action === "delete") {
    if (!hasRole(ctx, "manager")) throw HttpError.forbidden("Deleting leads needs the manager role.");
    const deleted = await leadsDb.removeMany(orgId, ids);
    for (const leadId of deleted) events.emit("lead.deleted", { orgId, actorId: userId, leadId });
    return send(res, { affected: deleted.length });
  }

  const before = await leadsDb.getMany(orgId, ids);
  let updated: LeadRow[] = [];
  let keys: string[] = [];

  if (body.action === "assign") {
    await assertMember(orgId, body.ownerId, "ownerId");
    keys = ["owner_id"];
    updated = await leadsDb.updateMany(orgId, ids, { owner_id: body.ownerId });
  } else if (body.action === "status") {
    keys = ["status"];
    updated = await leadsDb.updateMany(orgId, ids, { status: body.status });
  } else if (body.action === "tag" || body.action === "untag") {
    keys = ["tags"];
    const tags = body.tags;
    for (const lead of before) {
      const current: string[] = Array.isArray(lead.tags) ? lead.tags : [];
      const next =
        body.action === "tag" ? Array.from(new Set([...current, ...tags])) : current.filter((t) => !tags.includes(t));
      if (next.length === current.length && next.every((t, i) => t === current[i])) continue;
      const row = await leadsDb.update(orgId, lead.id, { tags: next });
      if (row) updated.push(row);
    }
  } else {
    const thresholds = await loadThresholds(orgId);
    for (const lead of before) {
      const row = await rescoreLead(orgId, lead.id, userId, thresholds);
      if (row && (row.score !== lead.score || row.status !== lead.status)) updated.push(row);
    }
    return send(res, { affected: updated.length });
  }

  const beforeById = new Map(before.map((l) => [l.id, l]));
  let affected = 0;
  for (const after of updated) {
    const prev = beforeById.get(after.id);
    if (!prev || Object.keys(diffFields(prev, after, keys)).length === 0) continue;
    affected++;
    await emitLeadChanges(orgId, userId, prev, after, keys);
  }
  send(res, { affected });
});

// GET /api/leads/:id
leadsRouter.get("/:id", async (req, res) => {
  const { orgId } = getCtx(req);
  send(res, toLeadDto(await getLeadOr404(orgId, parseId(req.params.id, "lead id"))));
});

// PATCH /api/leads/:id — partial update; rescored when a scoring field changes (unless score is given)
leadsRouter.patch("/:id", async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const id = parseId(req.params.id, "lead id");
  const body = parse(updateLeadSchema, req.body);
  await assertMember(orgId, body.ownerId, "ownerId");
  const before = await getLeadOr404(orgId, id);

  const patch = toRow(body);
  const merged = { ...before, ...patch };
  const touchesScoring = SCORING_FIELDS.some((f) => f in patch);
  if (body.score === undefined && touchesScoring) {
    const scored = scoredFields(merged, await loadThresholds(orgId), body.status !== undefined);
    patch.score = scored.score;
    patch.status = scored.status;
    patch.scored_at = scored.scored_at;
  }

  const after = await leadsDb.update(orgId, id, patch);
  if (!after) throw HttpError.notFound("Lead");
  await emitLeadChanges(orgId, userId, before, after, Object.keys(patch).filter((k) => k !== "scored_at"));
  send(res, toLeadDto(after));
});

// POST /api/leads/:id/rescore
leadsRouter.post("/:id/rescore", async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const lead = await rescoreLead(orgId, parseId(req.params.id, "lead id"), userId);
  if (!lead) throw HttpError.notFound("Lead");
  send(res, toLeadDto(lead));
});

async function deleteLead(orgId: string, userId: string, id: string) {
  const deleted = await dbQueries.deleteLead(orgId, id);
  if (!deleted) throw HttpError.notFound("Lead");
  events.emit("lead.deleted", { orgId, actorId: userId, leadId: id });
}

// DELETE /api/leads/:id (manager+)
leadsRouter.delete("/:id", requireRole("manager"), async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const id = parseId(req.params.id, "lead id");
  await deleteLead(orgId, userId, id);
  send(res, { id, deleted: true });
});

// DELETE /api/leads/:id/erase — permanent deletion for data-subject erasure requests (manager+)
leadsRouter.delete("/:id/erase", requireRole("manager"), async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const id = parseId(req.params.id, "lead id");
  await deleteLead(orgId, userId, id);
  send(res, { id, deleted: true });
});

// GET /api/leads/:id/activities — timeline (includes activities of the lead's deals)
leadsRouter.get("/:id/activities", async (req, res) => {
  const { orgId } = getCtx(req);
  const lead = await getLeadOr404(orgId, parseId(req.params.id, "lead id"));
  send(res, await activitiesDb.list(orgId, { leadId: lead.id, limit: 200 }));
});

// POST /api/leads/:id/activities — log a note / call / email / whatsapp / meeting
leadsRouter.post("/:id/activities", async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const lead = await getLeadOr404(orgId, parseId(req.params.id, "lead id"));
  const body = parse(activityInputSchema, req.body);
  const activity = await createActivity(orgId, userId, { ...body, leadId: lead.id });

  if (body.type !== "note") {
    const patch: Record<string, unknown> = { last_contacted_at: activity.occurred_at };
    if ((lead.status ?? "New") === "New") patch.status = "Contacted";
    const after = await leadsDb.update(orgId, lead.id, patch);
    if (after?.status !== lead.status && after) {
      await recordStatusChange(orgId, userId, lead.id, lead.status ?? null, after.status, { reason: `Logged a ${body.type}` });
    }
  }
  send(res, activity, 201);
});

// GET /api/leads/:id/tasks
leadsRouter.get("/:id/tasks", async (req, res) => {
  const { orgId } = getCtx(req);
  const lead = await getLeadOr404(orgId, parseId(req.params.id, "lead id"));
  send(res, await tasksDb.list(orgId, { leadId: lead.id }));
});

// POST /api/leads/:id/tasks — follow-up task
leadsRouter.post("/:id/tasks", async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const lead = await getLeadOr404(orgId, parseId(req.params.id, "lead id"));
  const body = parse(taskInputSchema, req.body);
  send(res, await createTask(orgId, userId, { ...body, leadId: lead.id }), 201);
});

registerJobHandler("lead.rescore", async ({ leadId }, { orgId }) => {
  if (orgId) await rescoreLead(orgId, leadId, null);
});

// Queued once per lead by the leads insert trigger (migration 0015) for Meta / Google webhook leads.
registerJobHandler("lead.ingested", async ({ leadId }, { orgId }) => {
  if (!orgId) throw new PermanentJobError("lead.ingested job has no org");
  await ingestExternalLead(orgId, leadId);
});

events.on("settings.updated", async ({ orgId, changes }) => {
  if (!changes.includes("scoring")) return;
  const changed = await rescoreAllLeads(orgId);
  if (changed > 0) console.log(`[Leads] Rescored ${changed} lead(s) after scoring thresholds changed.`);
});
