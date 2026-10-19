import { dbClient } from "../client";
import { dbError } from "../helpers";

export interface AuditEntry {
  orgId: string;
  actorId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

export const auditDb = {
  async record(entry: AuditEntry): Promise<void> {
    const { error } = await dbClient.from("audit_log").insert({
      org_id: entry.orgId,
      actor_id: entry.actorId ?? null,
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      metadata: entry.metadata ?? {},
    });
    if (error) throw dbError("record audit log", error);
  },

  async list(orgId: string, limit = 100) {
    const { data, error } = await dbClient
      .from("audit_log")
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw dbError("list audit log", error);
    return data || [];
  },

  /** System-wide retention: deletes up to `batchSize` rows created before `before`; returns how many. */
  async purgeBefore(before: Date, batchSize = 1000): Promise<number> {
    const { data, error } = await dbClient.rpc("purge_audit_log", { p_before: before.toISOString(), p_limit: batchSize });
    if (error) throw dbError("purge audit log", error);
    return Number(data) || 0;
  },
};
