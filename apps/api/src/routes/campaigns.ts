import { z } from "zod";
import { campaignsDb, type CampaignPatch, type CampaignRow } from "@ai-lead-gen/database";
import { createRouter } from "../http/router";
import { HttpError } from "../http/errors";
import { parsePagination, send, sendPage } from "../http/pagination";
import { parse, parseId } from "../http/validate";
import { rateLimit } from "../http/rateLimit";
import { getCtx, requireRole } from "../middleware/auth";
import { audienceFilterSchema } from "../campaigns/audience";
import { toCampaignDto, toRecipientDto, toStepDto } from "../campaigns/dto";
import {
  addLeadsToCampaign,
  computeStats,
  deleteCampaign,
  getChannelConfig,
  launchCampaign,
  markRecipientReplied,
  pauseCampaign,
  previewAudience,
  resumeCampaign,
} from "../campaigns/service";
import { campaignFunnel } from "../campaigns/stats";
import {
  channelSchema,
  createCampaignSchema,
  replaceStepsSchema,
  stepBodyToRow,
  updateCampaignSchema,
  validateSteps,
  type StepBody,
} from "../campaigns/validation";

/** Mounted at /api/campaigns behind requireAuth(); owned by the Campaigns module. */
export const campaignsRouter = createRouter();

const manager = requireRole("manager");
const launchLimit = rateLimit({ name: "campaign-launch", windowMs: 60_000, max: 10 });

const STATUSES = ["draft", "scheduled", "active", "paused", "completed"] as const;
const RECIPIENT_STATUSES = ["pending", "active", "completed", "replied", "bounced", "unsubscribed", "failed", "skipped"] as const;

const listQuery = z.object({
  status: z.enum(STATUSES).optional(),
  channel: channelSchema.optional(),
});

const recipientsQuery = z.object({ status: z.enum(RECIPIENT_STATUSES).optional() });

const previewSchema = z
  .object({
    channel: channelSchema,
    audienceFilter: audienceFilterSchema.default({ type: "filter" }),
    campaignId: z.string().uuid().nullable().optional(),
  })
  .strict();

const addLeadsSchema = z
  .object({ leadIds: z.array(z.string().uuid("Invalid lead id")).min(1, "Pick at least one lead").max(5_000) })
  .strict();

async function loadCampaign(orgId: string, rawId: unknown): Promise<CampaignRow> {
  const campaign = await campaignsDb.get(orgId, parseId(rawId, "campaign id"));
  if (!campaign) throw HttpError.notFound("Campaign");
  return campaign;
}

function assertSteps(channel: "email" | "whatsapp", steps: StepBody[]) {
  const fields = validateSteps(channel, steps);
  if (Object.keys(fields).length > 0) throw new HttpError(400, "VALIDATION_ERROR", "Some steps are incomplete.", fields);
}

function assertFutureSchedule(scheduledAt: string | null | undefined) {
  if (scheduledAt && new Date(scheduledAt).getTime() < Date.now() - 60_000) {
    throw new HttpError(400, "VALIDATION_ERROR", "The schedule must be in the future.", {
      scheduledAt: ["Pick a future date and time"],
    });
  }
}

async function detail(orgId: string, campaign: CampaignRow) {
  const [steps, stats] = await Promise.all([campaignsDb.listSteps(orgId, campaign.id), computeStats(orgId, campaign.id)]);
  const channel = await getChannelConfig(orgId, campaign);
  return {
    ...toCampaignDto(campaign, { stepsCount: steps.length }),
    steps: steps.map(toStepDto),
    stats,
    funnel: campaignFunnel(stats, campaign.channel),
    channelReady: !("error" in channel),
    channelError: "error" in channel ? channel.error : null,
  };
}

// GET /api/campaigns?page&pageSize&sort&q&status&channel
campaignsRouter.get("/", async (req, res) => {
  const { orgId } = getCtx(req);
  const page = parsePagination(req.query, {
    sortable: { createdAt: "created_at", updatedAt: "updated_at", name: "name", status: "status", launchedAt: "launched_at" },
    defaultSort: "createdAt:desc",
  });
  const filter = parse(listQuery, req.query);
  const { rows, total } = await campaignsDb.list(orgId, page, { ...filter, q: page.q });
  const stepCounts = await campaignsDb.stepCounts(
    orgId,
    rows.map((r) => r.id)
  );
  sendPage(
    res,
    rows.map((r) => toCampaignDto(r, { stepsCount: stepCounts[r.id] ?? 0 })),
    total,
    page
  );
});

// POST /api/campaigns/audience/preview { channel, audienceFilter, campaignId? }
campaignsRouter.post("/audience/preview", async (req, res) => {
  const { orgId } = getCtx(req);
  const body = parse(previewSchema, req.body);
  if (body.campaignId) await loadCampaign(orgId, body.campaignId);
  send(res, await previewAudience(orgId, body.channel, body.audienceFilter, body.campaignId));
});

// POST /api/campaigns (manager)
campaignsRouter.post("/", manager, async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const body = parse(createCampaignSchema, req.body);
  if (body.steps) assertSteps(body.channel, body.steps);
  assertFutureSchedule(body.scheduledAt);

  const campaign = await campaignsDb.create(orgId, {
    name: body.name,
    description: body.description ?? null,
    channel: body.channel,
    audience_filter: body.audienceFilter ?? { type: "filter" },
    send_window: body.sendWindow ?? {},
    throttle_per_hour: body.throttlePerHour,
    from_identity: body.fromIdentity ?? {},
    scheduled_at: body.scheduledAt ?? null,
    created_by: userId,
  });
  if (body.steps?.length) {
    try {
      await campaignsDb.replaceSteps(orgId, campaign.id, body.steps.map(stepBodyToRow));
    } catch (err) {
      await campaignsDb.remove(orgId, campaign.id);
      throw err;
    }
  }
  send(res, await detail(orgId, campaign), 201);
});

// GET /api/campaigns/:id
campaignsRouter.get("/:id", async (req, res) => {
  const { orgId } = getCtx(req);
  send(res, await detail(orgId, await loadCampaign(orgId, req.params.id)));
});

// PATCH /api/campaigns/:id (manager)
campaignsRouter.patch("/:id", manager, async (req, res) => {
  const { orgId } = getCtx(req);
  const campaign = await loadCampaign(orgId, req.params.id);
  const body = parse(updateCampaignSchema, req.body);
  const status = campaign.status;

  if (status === "completed" && Object.keys(body).some((k) => k !== "name" && k !== "description")) {
    throw HttpError.conflict("A completed campaign can only be renamed.");
  }
  if (status !== "draft" && (body.channel !== undefined || body.audienceFilter !== undefined)) {
    throw HttpError.conflict("Channel and audience can only be changed while the campaign is a draft.");
  }
  if (body.steps !== undefined && !["draft", "paused"].includes(status)) {
    throw HttpError.conflict("Pause the campaign before editing its steps.");
  }
  if (body.scheduledAt !== undefined && !["draft", "paused"].includes(status)) {
    throw HttpError.conflict("The schedule can only be changed while the campaign is a draft or paused.");
  }
  assertFutureSchedule(body.scheduledAt);
  const channel = body.channel ?? campaign.channel;
  if (body.steps) assertSteps(channel, body.steps);

  const patch: CampaignPatch = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.description !== undefined) patch.description = body.description;
  if (body.channel !== undefined) patch.channel = body.channel;
  if (body.audienceFilter !== undefined) patch.audience_filter = body.audienceFilter;
  if (body.sendWindow !== undefined) patch.send_window = body.sendWindow;
  if (body.throttlePerHour !== undefined) patch.throttle_per_hour = body.throttlePerHour;
  if (body.fromIdentity !== undefined) patch.from_identity = body.fromIdentity;
  if (body.scheduledAt !== undefined) patch.scheduled_at = body.scheduledAt;

  let updated = campaign;
  if (Object.keys(patch).length > 0) {
    updated = (await campaignsDb.update(orgId, campaign.id, patch)) ?? campaign;
  }
  if (body.steps !== undefined) await campaignsDb.replaceSteps(orgId, campaign.id, body.steps.map(stepBodyToRow));
  send(res, await detail(orgId, updated));
});

// DELETE /api/campaigns/:id (manager)
campaignsRouter.delete("/:id", manager, async (req, res) => {
  const { orgId } = getCtx(req);
  await deleteCampaign(orgId, parseId(req.params.id, "campaign id"));
  res.status(204).end();
});

// GET /api/campaigns/:id/steps
campaignsRouter.get("/:id/steps", async (req, res) => {
  const { orgId } = getCtx(req);
  const campaign = await loadCampaign(orgId, req.params.id);
  send(res, (await campaignsDb.listSteps(orgId, campaign.id)).map(toStepDto));
});

// PUT /api/campaigns/:id/steps { steps } (manager)
campaignsRouter.put("/:id/steps", manager, async (req, res) => {
  const { orgId } = getCtx(req);
  const campaign = await loadCampaign(orgId, req.params.id);
  if (!["draft", "paused"].includes(campaign.status)) throw HttpError.conflict("Pause the campaign before editing its steps.");
  const { steps } = parse(replaceStepsSchema, req.body);
  assertSteps(campaign.channel, steps);
  const rows = await campaignsDb.replaceSteps(orgId, campaign.id, steps.map(stepBodyToRow));
  send(res, rows.map(toStepDto));
});

// GET /api/campaigns/:id/audience/preview (saved filter + leads added manually)
campaignsRouter.get("/:id/audience/preview", async (req, res) => {
  const { orgId } = getCtx(req);
  const campaign = await loadCampaign(orgId, req.params.id);
  const filter = audienceFilterSchema.safeParse(campaign.audience_filter ?? {});
  send(res, await previewAudience(orgId, campaign.channel, filter.success ? filter.data : { type: "manual" }, campaign.id));
});

// POST /api/campaigns/:id/leads { leadIds } (manager): add leads to the audience
campaignsRouter.post("/:id/leads", manager, async (req, res) => {
  const { orgId } = getCtx(req);
  const id = parseId(req.params.id, "campaign id");
  const { leadIds } = parse(addLeadsSchema, req.body);
  send(res, await addLeadsToCampaign(orgId, id, leadIds));
});

// GET /api/campaigns/:id/recipients?page&pageSize&status
campaignsRouter.get("/:id/recipients", async (req, res) => {
  const { orgId } = getCtx(req);
  const campaign = await loadCampaign(orgId, req.params.id);
  const page = parsePagination(req.query, {
    sortable: { createdAt: "created_at", updatedAt: "updated_at", status: "status", nextRunAt: "next_run_at" },
    defaultSort: "createdAt:asc",
  });
  const { status } = parse(recipientsQuery, req.query);
  const { rows, total } = await campaignsDb.pageRecipients(orgId, campaign.id, page, { status });
  const latest = await campaignsDb.latestRecipientMessages(
    orgId,
    rows.map((r) => r.id)
  );
  sendPage(
    res,
    rows.map((r) => toRecipientDto(r, latest.get(r.id))),
    total,
    page
  );
});

// DELETE /api/campaigns/:id/recipients/:recipientId (manager): only before anything was sent
campaignsRouter.delete("/:id/recipients/:recipientId", manager, async (req, res) => {
  const { orgId } = getCtx(req);
  const campaign = await loadCampaign(orgId, req.params.id);
  const recipientId = parseId(req.params.recipientId, "recipient id");
  if (!(await campaignsDb.removePendingRecipient(orgId, campaign.id, recipientId))) {
    throw HttpError.conflict("Only recipients that have not been contacted can be removed.");
  }
  res.status(204).end();
});

// POST /api/campaigns/:id/recipients/:recipientId/replied (manager): email replies land in your inbox
campaignsRouter.post("/:id/recipients/:recipientId/replied", manager, async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const campaign = await loadCampaign(orgId, req.params.id);
  await markRecipientReplied(orgId, userId, campaign.id, parseId(req.params.recipientId, "recipient id"));
  send(res, { ok: true });
});

// GET /api/campaigns/:id/stats
campaignsRouter.get("/:id/stats", async (req, res) => {
  const { orgId } = getCtx(req);
  const campaign = await loadCampaign(orgId, req.params.id);
  const stats = await computeStats(orgId, campaign.id);
  send(res, { stats, funnel: campaignFunnel(stats, campaign.channel) });
});

// POST /api/campaigns/:id/launch (manager)
campaignsRouter.post("/:id/launch", manager, launchLimit, async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const result = await launchCampaign(orgId, userId, parseId(req.params.id, "campaign id"));
  send(res, {
    campaign: await detail(orgId, result.campaign),
    recipients: result.recipients,
    skipped: result.skipped,
    excluded: result.excluded,
    firstSendAt: result.firstSendAt,
  });
});

// POST /api/campaigns/:id/pause (manager)
campaignsRouter.post("/:id/pause", manager, async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const campaign = await pauseCampaign(orgId, userId, parseId(req.params.id, "campaign id"));
  send(res, await detail(orgId, campaign));
});

// POST /api/campaigns/:id/resume (manager)
campaignsRouter.post("/:id/resume", manager, launchLimit, async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const campaign = await resumeCampaign(orgId, userId, parseId(req.params.id, "campaign id"));
  send(res, await detail(orgId, campaign));
});
