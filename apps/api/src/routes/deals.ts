import { z } from "zod";
import { activitiesDb, dealsDb, leadsDb, tasksDb, type DealRow } from "@ai-lead-gen/database";
import { createRouter } from "../http/router";
import { HttpError } from "../http/errors";
import { send } from "../http/pagination";
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

// GET /api/deals?stage&ownerId=me|unassigned|<id>&leadId&q — the whole board (not paginated)
dealsRouter.get("/", async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const query = parse(listQuerySchema, req.query);
  const deals = await dealsDb.list(orgId, {
    stage: query.stage,
    ownerId: query.ownerId === "me" ? userId : query.ownerId === "unassigned" ? null : query.ownerId,
    leadId: query.leadId,
    q: query.q,
  });
  send(res, deals);
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
