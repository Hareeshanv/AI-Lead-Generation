import { z } from "zod";
import { activitiesDb, dealsDb, tasksDb, type ActivityType } from "@ai-lead-gen/database";
import { createRouter } from "../http/router";
import { HttpError } from "../http/errors";
import { parsePagination, send, sendPage } from "../http/pagination";
import { parse, parseId } from "../http/validate";
import { getCtx, hasRole } from "../middleware/auth";
import { events } from "../events";
import "../services/crm/events";
import { assertMember } from "../services/leads/service";
import { syncDealFollowUp } from "../services/crm/service";

/** Activity types users can log by hand; the rest are written by the system. */
export const MANUAL_ACTIVITY_TYPES = ["note", "call", "email", "whatsapp", "meeting"] as const;

export const activityInputSchema = z
  .object({
    type: z.enum(MANUAL_ACTIVITY_TYPES),
    title: z.string().trim().max(200).nullish(),
    body: z.string().trim().max(10_000).nullish(),
    occurredAt: z.coerce.date().optional(),
  })
  .strict()
  .refine((a) => Boolean(a.title || a.body), { message: "Write something to log", path: ["body"] });

export const taskInputSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(200),
    description: z.string().trim().max(5_000).nullish(),
    dueAt: z.coerce.date().nullish(),
    assigneeId: z.string().uuid().nullish(),
    priority: z.enum(["low", "normal", "high"]).default("normal"),
    dealId: z.string().uuid().nullish(),
  })
  .strict();

type ActivityInput = z.output<typeof activityInputSchema> & { leadId?: string | null; dealId?: string | null };
type TaskInput = z.output<typeof taskInputSchema> & { leadId?: string | null };

export async function createActivity(orgId: string, actorId: string, input: ActivityInput) {
  const activity = await activitiesDb.create(orgId, {
    type: input.type as ActivityType,
    leadId: input.leadId ?? null,
    dealId: input.dealId ?? null,
    title: input.title ?? null,
    body: input.body ?? null,
    occurredAt: input.occurredAt?.toISOString(),
    actorId,
  });
  events.emit("activity.created", {
    orgId,
    actorId,
    activityId: activity.id,
    type: activity.type,
    leadId: activity.lead_id,
    dealId: activity.deal_id,
  });
  return activity;
}

export async function createTask(orgId: string, actorId: string, input: TaskInput) {
  await assertMember(orgId, input.assigneeId, "assigneeId");
  if (input.dealId && !(await dealsDb.get(orgId, input.dealId))) {
    throw HttpError.badRequest("That deal does not exist.", { dealId: ["Deal not found"] });
  }
  const task = await tasksDb.create(orgId, {
    title: input.title,
    description: input.description ?? null,
    leadId: input.leadId ?? null,
    dealId: input.dealId ?? null,
    dueAt: input.dueAt ? input.dueAt.toISOString() : null,
    assigneeId: input.assigneeId === undefined ? actorId : input.assigneeId,
    priority: input.priority,
    createdBy: actorId,
  });
  events.emit("task.created", {
    orgId,
    actorId,
    taskId: task.id,
    leadId: task.lead_id,
    dealId: task.deal_id,
    assigneeId: task.assignee_id,
  });
  await syncDealFollowUp(orgId, task.deal_id);
  return task;
}

/** Mounted at /api/tasks behind requireAuth(); follow-ups across leads and deals (CRM module). */
export const tasksRouter = createRouter();

const listQuerySchema = z.object({
  assignee: z.union([z.literal("me"), z.literal("all"), z.string().uuid()]).default("me"),
  status: z.enum(["open", "done", "cancelled"]).optional(),
  due: z.enum(["overdue", "today", "week"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

function dueBefore(due: "overdue" | "today" | "week" | undefined): string | undefined {
  if (!due) return undefined;
  const now = new Date();
  if (due === "overdue") return now.toISOString();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  if (due === "week") end.setDate(end.getDate() + 7);
  return end.toISOString();
}

// GET /api/tasks?assignee=me|all|<userId>&status=open|done|cancelled&due=overdue|today|week — up to `limit`;
// with page/pageSize, one page as { data, meta }
tasksRouter.get("/", async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const query = parse(listQuerySchema, req.query);
  const filter = {
    assigneeId: query.assignee === "me" ? userId : query.assignee === "all" ? undefined : query.assignee,
    status: query.status,
    dueBefore: dueBefore(query.due),
    withContext: true,
  };
  if (req.query.page === undefined && req.query.pageSize === undefined) {
    return send(res, await tasksDb.list(orgId, { ...filter, limit: query.limit }));
  }
  const pagination = parsePagination(req.query, { sortable: {} });
  const { rows, total } = await tasksDb.listPage(orgId, filter, pagination);
  sendPage(res, rows, total, pagination);
});

const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(200),
    description: z.string().trim().max(5_000).nullable(),
    dueAt: z.coerce.date().nullable(),
    assigneeId: z.string().uuid().nullable(),
    priority: z.enum(["low", "normal", "high"]),
    status: z.enum(["open", "done", "cancelled"]),
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, "Nothing to update");

// PATCH /api/tasks/:id
tasksRouter.patch("/:id", async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const id = parseId(req.params.id, "task id");
  const body = parse(updateTaskSchema, req.body);
  await assertMember(orgId, body.assigneeId, "assigneeId");
  const before = await tasksDb.get(orgId, id);
  if (!before) throw HttpError.notFound("Task");

  const task = await tasksDb.update(orgId, id, {
    ...body,
    dueAt: body.dueAt === undefined ? undefined : body.dueAt ? body.dueAt.toISOString() : null,
  });
  if (!task) throw HttpError.notFound("Task");

  if (body.status === "done" && before.status !== "done") {
    events.emit("task.completed", { orgId, actorId: userId, taskId: id, leadId: task.lead_id, dealId: task.deal_id });
  }
  if (body.status !== undefined || body.dueAt !== undefined) await syncDealFollowUp(orgId, task.deal_id);
  send(res, task);
});

// DELETE /api/tasks/:id — creator, assignee or manager+
tasksRouter.delete("/:id", async (req, res) => {
  const ctx = getCtx(req);
  const id = parseId(req.params.id, "task id");
  const task = await tasksDb.get(ctx.orgId, id);
  if (!task) throw HttpError.notFound("Task");
  if (task.created_by !== ctx.userId && task.assignee_id !== ctx.userId && !hasRole(ctx, "manager")) {
    throw HttpError.forbidden("Only the task's creator, assignee or a manager can delete it.");
  }
  await tasksDb.remove(ctx.orgId, id);
  await syncDealFollowUp(ctx.orgId, task.deal_id);
  res.status(204).end();
});

/** Mounted at /api/activities behind requireAuth(). */
export const activitiesRouter = createRouter();

// DELETE /api/activities/:id — hand-logged entries only; author or manager+
activitiesRouter.delete("/:id", async (req, res) => {
  const ctx = getCtx(req);
  const id = parseId(req.params.id, "activity id");
  const activity = await activitiesDb.get(ctx.orgId, id);
  if (!activity) throw HttpError.notFound("Activity");
  if (!(MANUAL_ACTIVITY_TYPES as readonly string[]).includes(activity.type)) {
    throw HttpError.badRequest("System timeline entries cannot be deleted.");
  }
  if (activity.actor_id !== ctx.userId && !hasRole(ctx, "manager")) {
    throw HttpError.forbidden("Only the author or a manager can delete this entry.");
  }
  await activitiesDb.remove(ctx.orgId, id);
  res.status(204).end();
});
