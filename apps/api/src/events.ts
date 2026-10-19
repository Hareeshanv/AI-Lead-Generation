import { auditDb } from "@ai-lead-gen/database";

/** Fields every domain event carries. actorId is null for system/webhook/job originated events. */
export interface EventBase {
  orgId: string;
  actorId?: string | null;
}

/**
 * Domain events. Add new events here (one line each) rather than emitting untyped names.
 * Subscribers: workflow engine, notifications, activity timeline, analytics.
 */
export interface DomainEventMap {
  /** imported: part of a bulk CSV import, which is announced once by lead.imported instead of per lead. */
  "lead.created": EventBase & {
    leadId: string;
    source?: string | null;
    lead?: Record<string, any>;
    imported?: boolean;
    /** Inserted outside the API (lead-webhook edge function) and bridged by the lead.ingested job. */
    ingested?: boolean;
  };
  "lead.updated": EventBase & { leadId: string; changes: Record<string, { from: unknown; to: unknown }> };
  "lead.status_changed": EventBase & { leadId: string; from: string | null; to: string };
  "lead.score_changed": EventBase & { leadId: string; from: number | null; to: number };
  "lead.assigned": EventBase & { leadId: string; ownerId: string | null; previousOwnerId?: string | null };
  "lead.deleted": EventBase & { leadId: string };
  "lead.imported": EventBase & { count: number; leadIds: string[] };

  "deal.created": EventBase & { dealId: string; leadId?: string | null };
  "deal.updated": EventBase & { dealId: string; changes: Record<string, { from: unknown; to: unknown }> };
  "deal.stage_changed": EventBase & { dealId: string; leadId?: string | null; from: string | null; to: string };
  "deal.assigned": EventBase & { dealId: string; ownerId: string | null };
  "deal.deleted": EventBase & { dealId: string };

  "task.created": EventBase & { taskId: string; leadId?: string | null; dealId?: string | null; assigneeId?: string | null };
  "task.completed": EventBase & { taskId: string; leadId?: string | null; dealId?: string | null };

  "campaign.launched": EventBase & { campaignId: string; recipients: number };
  "campaign.paused": EventBase & { campaignId: string };
  "campaign.resumed": EventBase & { campaignId: string };
  "campaign.completed": EventBase & { campaignId: string };
  "campaign.message_status": EventBase & {
    campaignId: string | null;
    messageId: string;
    leadId: string | null;
    channel: "email" | "whatsapp";
    status: string;
  };
  "campaign.replied": EventBase & {
    campaignId: string | null;
    messageId: string;
    leadId: string | null;
    channel: "email" | "whatsapp";
    body?: string | null;
  };

  "agent.run_started": EventBase & { runId: string; query: string; location?: string | null };
  "agent.run_completed": EventBase & {
    runId: string;
    status: "completed" | "completed_with_errors" | "failed";
    leadsCreated: number;
    signalsFound: number;
  };

  "workflow.run_completed": EventBase & { workflowId: string; runId: string; status: "succeeded" | "failed" | "skipped" };
  "workflow.run_failed": EventBase & { workflowId: string; workflowName: string; runId: string; relatedLeadId: string | null; error: string };

  "integration.status_changed": EventBase & { provider: string; status: "connected" | "not_configured" | "error"; error?: string | null };

  "member.invited": EventBase & { email: string; role: string; invitationId: string };
  "member.joined": EventBase & { userId: string; role: string };
  "member.role_changed": EventBase & { userId: string; from: string; to: string };
  "member.removed": EventBase & { userId: string };

  "settings.updated": EventBase & { changes: string[] };
}

export type DomainEventName = keyof DomainEventMap;
export type DomainEvent<K extends DomainEventName = DomainEventName> = { name: K; payload: DomainEventMap[K]; at: string };
export type EventHandler<K extends DomainEventName> = (payload: DomainEventMap[K], event: DomainEvent<K>) => unknown;
export type AnyEventHandler = (event: DomainEvent) => unknown;

/** Events that are not written to audit_log (high-volume or system noise). */
const NOT_AUDITED = new Set<DomainEventName>(["campaign.message_status", "lead.score_changed"]);

function entityOf(name: DomainEventName, payload: Record<string, any>): { type: string; id: string | null } {
  const type = name.split(".")[0];
  const id =
    payload.leadId ?? payload.dealId ?? payload.taskId ?? payload.campaignId ?? payload.runId ??
    payload.workflowId ?? payload.invitationId ?? payload.userId ?? payload.provider ?? null;
  return { type, id: id == null ? null : String(id) };
}

class EventBus {
  private handlers = new Map<DomainEventName, Set<EventHandler<any>>>();
  private anyHandlers = new Set<AnyEventHandler>();

  /** Subscribe to one event. Returns an unsubscribe function. */
  on<K extends DomainEventName>(name: K, handler: EventHandler<K>): () => void {
    let set = this.handlers.get(name);
    if (!set) this.handlers.set(name, (set = new Set()));
    set.add(handler);
    return () => set!.delete(handler);
  }

  /** Subscribe to every event (workflow engine). Returns an unsubscribe function. */
  onAny(handler: AnyEventHandler): () => void {
    this.anyHandlers.add(handler);
    return () => this.anyHandlers.delete(handler);
  }

  /**
   * Fire-and-forget: handlers run after the current request finishes its synchronous work and a
   * failing handler never affects the emitter or other handlers.
   */
  emit<K extends DomainEventName>(name: K, payload: DomainEventMap[K]): void {
    void this.emitAndWait(name, payload);
  }

  /** Same as emit, but resolves once every handler has settled (tests, jobs). */
  async emitAndWait<K extends DomainEventName>(name: K, payload: DomainEventMap[K]): Promise<void> {
    const event: DomainEvent<K> = { name, payload, at: new Date().toISOString() };
    await Promise.resolve();
    const tasks: Promise<unknown>[] = [];
    const run = (label: string, fn: () => unknown) =>
      tasks.push(
        Promise.resolve()
          .then(fn)
          .catch((err) => console.error(`[Events] ${label} handler for ${name} failed:`, err?.message || err))
      );

    if (!NOT_AUDITED.has(name) && payload.orgId) {
      const entity = entityOf(name, payload as Record<string, any>);
      run("audit", () =>
        auditDb.record({
          orgId: payload.orgId,
          actorId: payload.actorId ?? null,
          action: name,
          entityType: entity.type,
          entityId: entity.id,
          metadata: payload as unknown as Record<string, unknown>,
        })
      );
    }
    for (const handler of this.handlers.get(name) || []) run("event", () => handler(payload, event));
    for (const handler of this.anyHandlers) run("any", () => handler(event as DomainEvent));
    await Promise.all(tasks);
  }
}

export const events = new EventBus();
