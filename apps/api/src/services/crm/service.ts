import { activitiesDb, dealsDb, leadsDb, tasksDb, type DealRow } from "@ai-lead-gen/database";
import { HttpError } from "../../http/errors";
import { events } from "../../events";
import { recordStatusChange } from "../leads/service";
import { isClosedStage, leadStatusForDealStage, stageChangePatch } from "./pipeline";

/**
 * Applies a deal's new stage to its lead: sets leads.stage and the implied status. A lost deal only
 * makes the lead Cold when the lead has no other open or won deal.
 */
export async function syncLeadWithDealStage(
  orgId: string,
  actorId: string | null,
  deal: Pick<DealRow, "id" | "lead_id" | "stage">
): Promise<void> {
  if (!deal.lead_id) return;
  const lead = await leadsDb.get(orgId, deal.lead_id);
  if (!lead) return;

  let status = leadStatusForDealStage(deal.stage);
  if (deal.stage === "Closed Lost") {
    const others = (await dealsDb.list(orgId, { leadId: lead.id })).filter((d) => d.id !== deal.id);
    if (others.some((d) => !isClosedStage(d.stage) || d.stage === "Closed Won")) status = null;
  }
  if (status && lead.status === "Closed" && status !== "Closed") status = null;

  const patch: Record<string, unknown> = { stage: deal.stage };
  if (status && status !== lead.status) patch.status = status;
  const updated = await leadsDb.update(orgId, lead.id, patch);
  if (updated && patch.status) {
    events.emit("lead.updated", {
      orgId,
      actorId,
      leadId: lead.id,
      changes: { status: { from: lead.status ?? null, to: updated.status } },
    });
    await recordStatusChange(orgId, actorId, lead.id, lead.status ?? null, updated.status, {
      reason: `Deal moved to ${deal.stage}`,
      dealId: deal.id,
    });
  }
}

/** Moves a deal to `stage`: writes the stage_change activity, emits deal.stage_changed and syncs the lead. */
export async function changeDealStage(
  orgId: string,
  actorId: string | null,
  before: DealRow,
  stage: string,
  options: { position?: number; lostReason?: string | null; extra?: Record<string, unknown> } = {}
): Promise<DealRow> {
  const patch: Record<string, unknown> =
    before.stage !== stage ? stageChangePatch(before, stage, { lostReason: options.lostReason }) : {};
  if (before.stage === stage && stage === "Closed Lost" && options.lostReason !== undefined) patch.lost_reason = options.lostReason;
  Object.assign(patch, options.extra ?? {});
  if (options.position !== undefined) patch.position = options.position;
  else if (before.stage !== stage) patch.position = (await dealsDb.minPosition(orgId, stage)) - 1;

  const deal = await dealsDb.update(orgId, before.id, patch);
  if (!deal) throw HttpError.notFound("Deal");

  if (before.stage !== stage) {
    await activitiesDb.create(orgId, {
      type: "stage_change",
      dealId: deal.id,
      leadId: deal.lead_id,
      title: `${deal.title} moved from ${before.stage ?? "none"} to ${stage}`,
      body: stage === "Closed Lost" ? (deal.lost_reason ?? null) : null,
      metadata: { from: before.stage ?? null, to: stage },
      actorId,
    });
    events.emit("deal.stage_changed", { orgId, actorId, dealId: deal.id, leadId: deal.lead_id, from: before.stage ?? null, to: stage });
    await syncLeadWithDealStage(orgId, actorId, deal);
  }
  return deal;
}

/** deals.next_follow_up_at = earliest due date among the deal's open tasks. */
export async function syncDealFollowUp(orgId: string, dealId: string | null | undefined): Promise<void> {
  if (!dealId) return;
  const open = await tasksDb.list(orgId, { dealId, status: "open", limit: 200 });
  const next = (open as any[])
    .map((t) => t.due_at as string | null)
    .filter((d): d is string => Boolean(d))
    .sort()[0];
  await dealsDb.update(orgId, dealId, { next_follow_up_at: next ?? null });
}
