import { z } from "zod";
import { activitiesDb, dealsDb, leadsDb, tasksDb, type DealListFilters, type DealRow } from "@ai-lead-gen/database";
import { createRouter } from "../http/router";
import { HttpError } from "../http/errors";
import { parsePagination, send, sendPage } from "../http/pagination";
import { parse, parseId, queryList } from "../http/validate";
import { getCtx, requireRole } from "../middleware/auth";
import { events } from "../events";
import { DEAL_STAGES, STAGE_PROBABILITY, isClosedStage } from "../services/crm/pipeline";
import { changeDealStage, syncLeadWithDealStage } from "../services/crm/service";
import { assertMember, diffFields } from "../services/leads/service";
import { activityInputSchema, createActivity, createTask, taskInputSchema } from "./tasks";

/** Mounted at /api/deals behind requireAuth(); owned by the CRM module. */
export const dealsRouter = createRouter();

const stageSchema = z.enum(DEAL_STAGES);
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const dealFields = {
  title: z.string().trim().min(1, "Title is required").max(200),
  company: nullableText(200),
  contact: nullableText(200),
  value: z.coerce.number().min(0, "Value can't be negative").max(1e12),
  probability: z.coerce.number().int().min(0).max(100),
  stage: stageSchema,
  expectedClose: z.string().date("Use a YYYY-MM-DD date").nullable(),
  ownerId: z.string().uuid().nullable(),
  leadId: z.string().uuid().nullable(),
  nextFollowUpAt: z.coerce.date().nullable(),
  lostReason: nullableText(1000),
};

const createDealSchema = z
  .object({
    ...dealFields,
    company: dealFields.company.optional(),
    contact: dealFields.contact.optional(),
    value: dealFields.value.default(0),
    probability: dealFields.probability.optional(),
    stage: dealFields.stage.default("New"),
    expectedClose: dealFields.expectedClose.optional(),
    ownerId: dealFields.ownerId.optional(),
    leadId: dealFields.leadId.optional(),
    nextFollowUpAt: dealFields.nextFollowUpAt.optional(),
    lostReason: dealFields.lostReason.optional(),
  })
  .strict();

const updateDealSchema = z
  .object(dealFields)
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, "Nothing to update");

const COLUMN: Record<string, string> = {
  expectedClose: "expected_close",
  ownerId: "owner_id",
  leadId: "lead_id",
  nextFollowUpAt: "next_follow_up_at",
  lostReason: "lost_reason",
};

function toRow(body: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) continue;
    row[COLUMN[key] ?? key] = value instanceof Date ? value.toISOString() : value;
  }
  return row;
}

async function getDealOr404(orgId: string, id: string): Promise<DealRow> {
  const deal = await dealsDb.get(orgId, id);
  if (!deal) throw HttpError.notFound("Deal");
  return deal;
}

async function assertLead(orgId: string, leadId: string | null | undefined) {
  if (!leadId) return null;
  const lead = await leadsDb.get(orgId, leadId);
  if (!lead) throw HttpError.badRequest("That lead does not exist.", { leadId: ["Lead not found"] });
  return lead;
}

const listQuerySchema = z.object({
  stage: queryList.optional(),
  ownerId: z.union([z.literal("me"), z.literal("unassigned"), z.string().uuid()]).optional(),
  leadId: z.string().uuid().optional(),
  q: z.string().trim().max(200).optional(),
});

function listFilters(query: z.output<typeof listQuerySchema>, userId: string): DealListFilters {
  return {
    stage: query.stage,
    ownerId: query.ownerId === "me" ? userId : query.ownerId === "unassigned" ? null : query.ownerId,
    leadId: query.leadId,
    q: query.q,
  };
}

// GET /api/deals?stage&ownerId=me|unassigned|<id>&leadId&q — every matching deal (up to 2,000);
// with page/pageSize, one page in board order as { data, meta }
dealsRouter.get("/", async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const filters = listFilters(parse(listQuerySchema, req.query), userId);
  if (req.query.page === undefined && req.query.pageSize === undefined) return send(res, await dealsDb.list(orgId, filters));
  const pagination = parsePagination(req.query, { sortable: {} });
  const { rows, total } = await dealsDb.listPage(orgId, filters, pagination);
  sendPage(res, rows, total, pagination);
});

const BOARD_PER_STAGE = 50;
const MAX_STAGE_LIMIT = 1000;

const boardQuerySchema = listQuerySchema.extend({
  perStage: z.coerce.number().int().min(1).max(MAX_STAGE_LIMIT).default(BOARD_PER_STAGE),
  /** Per-stage overrides of perStage for columns the user expanded: "Qualified:100,Closed Won:150". */
  expand: z.string().max(500).optional(),
});

function parseExpand(expand: string | undefined): Map<string, number> {
  const limits = new Map<string, number>();
  for (const part of (expand ?? "").split(",")) {
    const sep = part.lastIndexOf(":");
    const stage = part.slice(0, sep).trim();
    const limit = Number(part.slice(sep + 1));
    if (sep > 0 && (DEAL_STAGES as readonly string[]).includes(stage) && Number.isInteger(limit) && limit > 0) {
      limits.set(stage, Math.min(limit, MAX_STAGE_LIMIT));
    }
  }
  return limits;
}

// GET /api/deals/board?perStage&expand&ownerId&q — the first deals of each stage plus every stage's
// count / value / weighted value, so the board doesn't load the whole pipeline
dealsRouter.get("/board", async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const query = parse(boardQuerySchema, req.query);
  const filters = listFilters({ ...query, stage: undefined }, userId);
  const expand = parseExpand(query.expand);
  const stages = (query.stage?.length ? DEAL_STAGES.filter((s) => query.stage!.includes(s)) : DEAL_STAGES) as string[];
  const [totals, pages] = await Promise.all([
    dealsDb.stageTotals(orgId, { ...filters, stage: stages }),
    Promise.all(stages.map((stage) => dealsDb.listPage(orgId, { ...filters, stage: [stage] }, { from: 0, to: (expand.get(stage) ?? query.perStage) - 1 }))),
  ]);
  send(res, {
    stages: stages.map((stage, i) => ({
      stage,
      deals: pages[i].rows,
      count: pages[i].total,
      value: totals[stage]?.value ?? 0,
      weighted: totals[stage]?.weighted ?? 0,
    })),
  });
});

// POST /api/deals — company/contact default from the linked lead
dealsRouter.post("/", async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const body = parse(createDealSchema, req.body);
  await assertMember(orgId, body.ownerId, "ownerId");
  const lead = await assertLead(orgId, body.leadId);

  const row = toRow({
    ...body,
    company: body.company ?? lead?.company ?? "",
    contact: body.contact ?? lead?.name ?? null,
    probability: body.probability ?? STAGE_PROBABILITY[body.stage],
    ownerId: body.ownerId === undefined ? (lead?.owner_id ?? userId) : body.ownerId,
    lostReason: body.stage === "Closed Lost" ? body.lostReason ?? null : undefined,
  });
  row.position = (await dealsDb.minPosition(orgId, body.stage)) - 1;
  row.created_by = userId;
  if (isClosedStage(body.stage)) row.closed_at = new Date().toISOString();

  const deal = await dealsDb.create(orgId, row);
  events.emit("deal.created", { orgId, actorId: userId, dealId: deal.id, leadId: deal.lead_id });
  if (deal.lead_id) {
    await activitiesDb.create(orgId, {
      type: "system",
      leadId: deal.lead_id,
      dealId: deal.id,
      title: `Deal created: ${deal.title}`,
      metadata: { stage: deal.stage, value: deal.value },
      actorId: userId,
    });
    await syncLeadWithDealStage(orgId, userId, deal);
  }
  send(res, (await dealsDb.get(orgId, deal.id)) ?? deal, 201);
});

const MAX_BULK_DEALS = 200;

const bulkCreateSchema = z
  .object({
    leadIds: z.array(z.string().uuid()).min(1, "Select at least one lead").max(MAX_BULK_DEALS),
    stage: dealFields.stage.default("New"),
    ownerId: dealFields.ownerId.optional(),
    value: dealFields.value.default(0),
  })
  .strict();

// POST /api/deals/bulk — one deal per lead (title/company/contact from the lead); ids that are not
// leads of this workspace come back in `missing`
dealsRouter.post("/bulk", async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const body = parse(bulkCreateSchema, req.body);
  await assertMember(orgId, body.ownerId, "ownerId");
  const ids = Array.from(new Set(body.leadIds));
  const order = new Map(ids.map((id, i) => [id, i]));
  const leads = (await leadsDb.getMany(orgId, ids)).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const found = new Set(leads.map((l) => l.id));
  const missing = ids.filter((id) => !found.has(id));

  const top = await dealsDb.minPosition(orgId, body.stage);
  const closedAt = isClosedStage(body.stage) ? new Date().toISOString() : null;
  const rows = leads.map((lead, i) => {
    const name = lead.company || lead.name;
    return {
      title: name ? `${name} opportunity` : "New opportunity",
      company: lead.company ?? "",
      contact: lead.name ?? null,
      value: body.value,
      stage: body.stage,
      probability: STAGE_PROBABILITY[body.stage],
      owner_id: body.ownerId === undefined ? (lead.owner_id ?? userId) : body.ownerId,
      lead_id: lead.id,
      // Keeps the selection order, first lead at the top of the column.
      position: top - (leads.length - i),
      created_by: userId,
      closed_at: closedAt,
    };
  });

  const deals = await dealsDb.createMany(orgId, rows);
  for (const deal of deals) {
    events.emit("deal.created", { orgId, actorId: userId, dealId: deal.id, leadId: deal.lead_id });
    await activitiesDb.create(orgId, {
      type: "system",
      leadId: deal.lead_id,
      dealId: deal.id,
      title: `Deal created: ${deal.title}`,
      metadata: { stage: deal.stage, value: deal.value },
      actorId: userId,
    });
    await syncLeadWithDealStage(orgId, userId, deal);
  }
  send(res, { created: deals.length, missing, deals }, 201);
});

// GET /api/deals/:id
dealsRouter.get("/:id", async (req, res) => {
  const { orgId } = getCtx(req);
  send(res, await getDealOr404(orgId, parseId(req.params.id, "deal id")));
});

const TRACKED = ["title", "company", "contact", "value", "probability", "expected_close", "owner_id", "lead_id", "next_follow_up_at", "lost_reason"];

// PATCH /api/deals/:id — edit fields; a stage in the body goes through the stage-change flow
dealsRouter.patch("/:id", async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const id = parseId(req.params.id, "deal id");
  const body = parse(updateDealSchema, req.body);
  await assertMember(orgId, body.ownerId, "ownerId");
  await assertLead(orgId, body.leadId);
  const before = await getDealOr404(orgId, id);

  const { stage, lostReason, ...rest } = body;
  const extra = toRow(rest);
  let deal: DealRow;
  if (stage !== undefined && stage !== before.stage) {
    deal = await changeDealStage(orgId, userId, before, stage, { lostReason, extra });
  } else {
    if (lostReason !== undefined) extra.lost_reason = lostReason;
    const updated = await dealsDb.update(orgId, id, extra);
    if (!updated) throw HttpError.notFound("Deal");
    deal = updated;
  }

  const changes = diffFields(before, deal, TRACKED);
  if (Object.keys(changes).length > 0) events.emit("deal.updated", { orgId, actorId: userId, dealId: id, changes });
  if (changes.owner_id) events.emit("deal.assigned", { orgId, actorId: userId, dealId: id, ownerId: deal.owner_id });
  if (changes.lead_id && deal.lead_id) await syncLeadWithDealStage(orgId, userId, deal);
  send(res, deal);
});

const stageChangeSchema = z
  .object({
    stage: stageSchema,
    /** Order within the column (lower = higher up). Defaults to the top of the column. */
    position: z.number().finite().optional(),
    lostReason: nullableText(1000).optional(),
  })
  .strict();

// PATCH /api/deals/:id/stage — Kanban move; writes a stage_change activity and syncs the lead status
dealsRouter.patch("/:id/stage", async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const id = parseId(req.params.id, "deal id");
  const { stage, position, lostReason } = parse(stageChangeSchema, req.body);
  const before = await getDealOr404(orgId, id);
  send(res, await changeDealStage(orgId, userId, before, stage, { position, lostReason }));
});

// DELETE /api/deals/:id (manager+)
dealsRouter.delete("/:id", requireRole("manager"), async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const id = parseId(req.params.id, "deal id");
  if (!(await dealsDb.remove(orgId, id))) throw HttpError.notFound("Deal");
  events.emit("deal.deleted", { orgId, actorId: userId, dealId: id });
  res.status(204).end();
});

// GET /api/deals/:id/activities
dealsRouter.get("/:id/activities", async (req, res) => {
  const { orgId } = getCtx(req);
  const deal = await getDealOr404(orgId, parseId(req.params.id, "deal id"));
  send(res, await activitiesDb.list(orgId, { dealId: deal.id, limit: 200 }));
});

// POST /api/deals/:id/activities — also appears on the linked lead's timeline
dealsRouter.post("/:id/activities", async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const deal = await getDealOr404(orgId, parseId(req.params.id, "deal id"));
  const body = parse(activityInputSchema, req.body);
  const activity = await createActivity(orgId, userId, { ...body, dealId: deal.id, leadId: deal.lead_id });
  if (body.type !== "note" && deal.lead_id) {
    await leadsDb.update(orgId, deal.lead_id, { last_contacted_at: activity.occurred_at });
  }
  send(res, activity, 201);
});

// GET /api/deals/:id/tasks
dealsRouter.get("/:id/tasks", async (req, res) => {
  const { orgId } = getCtx(req);
  const deal = await getDealOr404(orgId, parseId(req.params.id, "deal id"));
  send(res, await tasksDb.list(orgId, { dealId: deal.id }));
});

// POST /api/deals/:id/tasks — follow-up; updates the deal's next_follow_up_at
dealsRouter.post("/:id/tasks", async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const deal = await getDealOr404(orgId, parseId(req.params.id, "deal id"));
  const body = parse(taskInputSchema, req.body);
  send(res, await createTask(orgId, userId, { ...body, dealId: deal.id, leadId: deal.lead_id }), 201);
});
