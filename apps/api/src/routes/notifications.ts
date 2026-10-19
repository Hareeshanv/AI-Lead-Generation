import { z } from "zod";
import { notificationsDb } from "@ai-lead-gen/database";
import { createRouter } from "../http/router";
import { HttpError } from "../http/errors";
import { parsePagination, send, sendPage } from "../http/pagination";
import { parse, parseId, queryBoolean } from "../http/validate";
import { getCtx } from "../middleware/auth";
import { toNotificationDto } from "../notifications/service";

/** Mounted at /api/notifications behind requireAuth(); owned by the Notifications module. Always the caller's own. */
export const notificationsRouter = createRouter();

const NOTIFICATION_TYPES = ["lead", "deal", "campaign", "agent", "workflow", "integration", "task", "system"] as const;

const listQuery = z.object({
  unread: queryBoolean.optional(),
  type: z.enum(NOTIFICATION_TYPES).optional(),
});

// GET /api/notifications?page&pageSize&unread=true&type=lead
notificationsRouter.get("/", async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const pagination = parsePagination(req.query, { sortable: { createdAt: "created_at" } });
  const { unread, type } = parse(listQuery, { unread: req.query.unread, type: req.query.type });
  const { rows, total } = await notificationsDb.list(orgId, userId, {
    unreadOnly: unread,
    type,
    from: pagination.from,
    to: pagination.to,
  });
  sendPage(res, rows.map(toNotificationDto), total, pagination);
});

// GET /api/notifications/unread-count
notificationsRouter.get("/unread-count", async (req, res) => {
  const { orgId, userId } = getCtx(req);
  send(res, { count: await notificationsDb.unreadCount(orgId, userId) });
});

// POST /api/notifications/read-all
notificationsRouter.post("/read-all", async (req, res) => {
  const { orgId, userId } = getCtx(req);
  send(res, { updated: await notificationsDb.markRead(orgId, userId) });
});

// POST /api/notifications/read { ids: [...] }
notificationsRouter.post("/read", async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const { ids } = parse(z.object({ ids: z.array(z.string().uuid("Invalid id")).min(1).max(500) }), req.body ?? {});
  send(res, { updated: await notificationsDb.markRead(orgId, userId, ids) });
});

// POST /api/notifications/:id/read
notificationsRouter.post("/:id/read", async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const id = parseId(req.params.id, "notification id");
  send(res, { updated: await notificationsDb.markRead(orgId, userId, [id]) });
});

// DELETE /api/notifications?readOnly=true — clear all (or only read) notifications
notificationsRouter.delete("/", async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const { readOnly } = parse(z.object({ readOnly: queryBoolean.optional() }), { readOnly: req.query.readOnly });
  send(res, { deleted: await notificationsDb.clear(orgId, userId, { readOnly }) });
});

// DELETE /api/notifications/:id
notificationsRouter.delete("/:id", async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const id = parseId(req.params.id, "notification id");
  if (!(await notificationsDb.remove(orgId, userId, id))) throw HttpError.notFound("Notification");
  send(res, { id });
});
