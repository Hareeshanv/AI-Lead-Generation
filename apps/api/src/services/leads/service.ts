import { activitiesDb, leadsDb, orgsDb, settingsDb, type LeadRow } from "@ai-lead-gen/database";
import { HttpError } from "../../http/errors";
import { events } from "../../events";
import "../crm/events";
import { scoreLead, statusAfterScoring, type ScoringThresholds } from "./scoring";

/** Leads are returned as DB rows minus the (large) embedding vector. */
export function toLeadDto(row: LeadRow) {
  const { embedding: _embedding, ...rest } = row;
  return rest;
}

export async function loadThresholds(orgId: string): Promise<ScoringThresholds> {
  return (await settingsDb.get(orgId)).scoring;
}

/** Throws a 400 on `field` unless userId belongs to the org. */
export async function assertMember(orgId: string, userId: string | null | undefined, field: string): Promise<void> {
  if (!userId) return;
  if (!(await orgsDb.getMembership(orgId, userId))) {
    throw HttpError.badRequest("That user is not a member of this workspace.", { [field]: ["Not a workspace member"] });
  }
}

/** Score and band-following status for a row about to be written. */
export function scoredFields(row: Record<string, any>, thresholds: ScoringThresholds, keepStatus: boolean) {
  const { score, band } = scoreLead(row, thresholds);
  return { score, status: keepStatus ? row.status : statusAfterScoring(row.status, band), scored_at: new Date().toISOString() };
}

export function diffFields(before: Record<string, any>, after: Record<string, any>, keys: string[]) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of keys) {
    const a = before[key] ?? null;
    const b = after[key] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[key] = { from: a, to: b };
  }
  return changes;
}

/** Status-change timeline entry + event. Call after the status was persisted. */
export async function recordStatusChange(
  orgId: string,
  actorId: string | null,
  leadId: string,
  from: string | null,
  to: string,
  context: { reason?: string; dealId?: string | null } = {}
): Promise<void> {
  if ((from ?? null) === to) return;
  await activitiesDb.create(orgId, {
    type: "status_change",
    leadId,
    dealId: context.dealId ?? null,
    title: `Status changed from ${from ?? "none"} to ${to}`,
    body: context.reason ?? null,
    metadata: { from, to },
    actorId,
  });
  events.emit("lead.status_changed", { orgId, actorId, leadId, from, to });
}

/** Emits lead.updated / status / score / assigned events for a persisted change. */
export async function emitLeadChanges(
  orgId: string,
  actorId: string | null,
  before: LeadRow,
  after: LeadRow,
  changedKeys: string[]
): Promise<void> {
  const changes = diffFields(before, after, changedKeys);
  if (Object.keys(changes).length === 0) return;
  events.emit("lead.updated", { orgId, actorId, leadId: after.id, changes });
  if (changes.status) await recordStatusChange(orgId, actorId, after.id, before.status ?? null, after.status);
  if (changes.score) events.emit("lead.score_changed", { orgId, actorId, leadId: after.id, from: before.score ?? null, to: after.score });
  if (changes.owner_id) {
    events.emit("lead.assigned", { orgId, actorId, leadId: after.id, ownerId: after.owner_id ?? null, previousOwnerId: before.owner_id ?? null });
  }
}

/** Recomputes and persists one lead's score; returns the (possibly unchanged) lead or null if missing. */
export async function rescoreLead(
  orgId: string,
  leadId: string,
  actorId: string | null,
  thresholds?: ScoringThresholds
): Promise<LeadRow | null> {
  const lead = await leadsDb.get(orgId, leadId);
  if (!lead) return null;
  const fields = scoredFields(lead, thresholds ?? (await loadThresholds(orgId)), false);
  if (fields.score === lead.score && fields.status === lead.status) return lead;
  const updated = await leadsDb.update(orgId, leadId, fields);
  if (!updated) return null;
  await emitLeadChanges(orgId, actorId, lead, updated, ["score", "status"]);
  return updated;
}

/**
 * Bridges a lead the lead-webhook edge function inserted (job "lead.ingested", queued by a DB trigger):
 * scores it like an API-created lead and emits lead.created. Returns null when the lead is gone.
 */
export async function ingestExternalLead(orgId: string, leadId: string): Promise<LeadRow | null> {
  const lead = await leadsDb.get(orgId, leadId);
  if (!lead) return null;
  const fields = scoredFields(lead, await loadThresholds(orgId), false);
  const scored = (await leadsDb.update(orgId, leadId, fields)) ?? lead;
  events.emit("lead.created", {
    orgId,
    actorId: null,
    leadId,
    source: scored.source ?? null,
    lead: toLeadDto(scored),
    ingested: true,
  });
  return scored;
}

/** Rescores every lead in the org in pages (after the scoring thresholds change). */
export async function rescoreAllLeads(orgId: string, maxLeads = 10_000): Promise<number> {
  const thresholds = await loadThresholds(orgId);
  const pageSize = 500;
  let changed = 0;
  for (let from = 0; from < maxLeads; from += pageSize) {
    const { rows } = await leadsDb.list(orgId, {}, { from, to: from + pageSize - 1, sort: { column: "created_at", ascending: true } });
    for (const lead of rows) {
      const fields = scoredFields(lead, thresholds, false);
      if (fields.score === lead.score && fields.status === lead.status) continue;
      const updated = await leadsDb.update(orgId, lead.id, fields);
      if (updated) {
        changed++;
        await emitLeadChanges(orgId, null, lead, updated, ["score", "status"]);
      }
    }
    if (rows.length < pageSize) break;
  }
  return changed;
}
