import {
  notificationsDb,
  orgsDb,
  type EntityKind,
  type NewNotification,
  type NotificationRow,
  type NotificationType,
} from "@ai-lead-gen/database";
import { events, type DomainEvent } from "../events";
import { notificationPrefs, type NotificationPrefKey } from "../services/account";

export function toNotificationDto(row: NotificationRow) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    entityType: row.entity_type,
    entityId: row.entity_id,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

/** Who should hear about an event. "managers" = every admin and manager in the org. */
type Audience = { userIds: (string | null | undefined)[] } | "managers" | "admins";

interface Draft {
  audience: Audience;
  /** Preference that must be on for the recipient; omit for always-on notifications. */
  pref?: NotificationPrefKey;
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /** Also notify the user who caused the event (default: skip them). */
  includeActor?: boolean;
}

/** Persists a notification for each eligible recipient: org members, minus the actor, with the pref enabled. */
export async function notify(orgId: string, actorId: string | null | undefined, draft: Draft): Promise<number> {
  const members = await orgsDb.listMembers(orgId);
  const memberIds = new Set(members.map((m) => m.user_id));
  let candidates: string[];
  if (draft.audience === "managers" || draft.audience === "admins") {
    const roles = draft.audience === "admins" ? ["admin"] : ["admin", "manager"];
    candidates = members.filter((m) => roles.includes(m.role)).map((m) => m.user_id);
  } else {
    candidates = draft.audience.userIds.filter((id): id is string => !!id && memberIds.has(id));
  }
  let recipients = [...new Set(candidates)].filter((id) => draft.includeActor || id !== actorId);
  if (recipients.length === 0) return 0;

  if (draft.pref) {
    const prefs = await notificationsDb.getPrefs(recipients);
    recipients = recipients.filter((id) => notificationPrefs(prefs.get(id))[draft.pref!]);
  }
  const items: NewNotification[] = recipients.map((userId) => ({
    userId,
    type: draft.type,
    title: draft.title,
    body: draft.body ?? null,
    link: draft.link ?? null,
    entityType: draft.entityType ?? null,
    entityId: draft.entityId ?? null,
  }));
  return (await notificationsDb.insertMany(orgId, items)).length;
}

async function entity(orgId: string, kind: EntityKind, id: unknown): Promise<Record<string, any> | null> {
  if (typeof id !== "string" || !id) return null;
  try {
    return await notificationsDb.getEntity(orgId, kind, id);
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const leadLabel = (lead: Record<string, any> | null) =>
  lead ? [str(lead.name), str(lead.company)].filter(Boolean).join(" at ") || "a lead" : "a lead";
const ownerOf = (row: Record<string, any> | null) => str(row?.owner_id);

/** Leads created by the agent are summarised by agent.run_completed instead. */
const AGENT_SOURCES = new Set(["ai agent", "agent", "ai_agent", "discovery"]);

type Payload = Record<string, any>;
type Builder = (orgId: string, p: Payload) => Promise<Draft | Draft[] | null>;

const BUILDERS: Record<string, Builder> = {
  "lead.created": async (orgId, p) => {
    if (p.imported) return null;
    if (AGENT_SOURCES.has(String(p.source ?? p.lead?.source ?? "").toLowerCase())) return null;
    const lead = p.lead && p.lead.name ? p.lead : await entity(orgId, "leads", p.leadId);
    const owner = ownerOf(lead);
    return {
      audience: owner ? { userIds: [owner] } : "managers",
      pref: "newLead",
      type: "lead",
      title: `New lead: ${leadLabel(lead)}`,
      body: str(p.source ?? lead?.source) ? `Source: ${p.source ?? lead?.source}` : null,
      link: `/leads/${p.leadId}`,
      entityType: "lead",
      entityId: p.leadId,
    };
  },

  "lead.imported": async (_orgId, p) =>
    Number(p.count) > 0
      ? {
          audience: "managers",
          pref: "newLead",
          type: "lead",
          title: `${p.count} lead${p.count === 1 ? "" : "s"} imported`,
          link: "/leads",
          includeActor: false,
        }
      : null,

  "lead.assigned": async (orgId, p) => {
    if (!p.ownerId) return null;
    const lead = await entity(orgId, "leads", p.leadId);
    return {
      audience: { userIds: [p.ownerId] },
      pref: "leadAssigned",
      type: "lead",
      title: `You were assigned ${leadLabel(lead)}`,
      link: `/leads/${p.leadId}`,
      entityType: "lead",
      entityId: p.leadId,
    };
  },

  "deal.assigned": async (orgId, p) => {
    if (!p.ownerId) return null;
    const deal = await entity(orgId, "deals", p.dealId);
    return {
      audience: { userIds: [p.ownerId] },
      pref: "leadAssigned",
      type: "deal",
      title: `You were assigned the deal ${str(deal?.title) ?? ""}`.trim(),
      link: `/crm?deal=${p.dealId}`,
      entityType: "deal",
      entityId: p.dealId,
    };
  },

  "deal.stage_changed": async (orgId, p) => {
    const deal = await entity(orgId, "deals", p.dealId);
    const owner = ownerOf(deal);
    const won = /won/i.test(String(p.to));
    return {
      audience: owner ? { userIds: [owner] } : "managers",
      pref: "dealStageChanged",
      type: "deal",
      title: won
        ? `Deal won: ${str(deal?.title) ?? "a deal"}`
        : `${str(deal?.title) ?? "A deal"} moved to ${p.to}`,
      body: p.from ? `From ${p.from} to ${p.to}` : null,
      link: `/crm?deal=${p.dealId}`,
      entityType: "deal",
      entityId: p.dealId,
    };
  },

  "task.created": async (_orgId, p) =>
    p.assigneeId
      ? {
          audience: { userIds: [p.assigneeId] },
          pref: "taskDue",
          type: "task",
          title: "New follow-up task assigned to you",
          link: p.leadId ? `/leads/${p.leadId}` : p.dealId ? `/crm?deal=${p.dealId}` : null,
          entityType: "task",
          entityId: p.taskId,
        }
      : null,

  "campaign.replied": async (orgId, p) => {
    const [campaign, lead] = await Promise.all([entity(orgId, "campaigns", p.campaignId), entity(orgId, "leads", p.leadId)]);
    return {
      audience: { userIds: [str(campaign?.created_by), ownerOf(lead)] },
      pref: "campaignReplied",
      type: "campaign",
      title: `${leadLabel(lead)} replied${campaign?.name ? ` to ${campaign.name}` : ""}`,
      body: str(p.body)?.slice(0, 280) ?? null,
      link: p.leadId ? `/leads/${p.leadId}` : p.campaignId ? `/campaigns/${p.campaignId}` : "/campaigns",
      entityType: "campaign",
      entityId: p.campaignId ?? null,
      includeActor: true,
    };
  },

  "campaign.completed": async (orgId, p) => {
    const campaign = await entity(orgId, "campaigns", p.campaignId);
    return {
      audience: { userIds: [str(campaign?.created_by)] },
      pref: "campaignReplied",
      type: "campaign",
      title: `Campaign finished: ${str(campaign?.name) ?? "campaign"}`,
      link: `/campaigns/${p.campaignId}`,
      entityType: "campaign",
      entityId: p.campaignId,
      includeActor: true,
    };
  },

  "agent.run_completed": async (_orgId, p) => {
    const failed = p.status === "failed";
    const leads = Number(p.leadsCreated) || 0;
    const signals = Number(p.signalsFound) || 0;
    return {
      audience: p.actorId ? { userIds: [p.actorId] } : "managers",
      pref: "agentRunCompleted",
      type: "agent",
      title: failed ? "AI agent run failed" : `AI agent found ${leads} lead${leads === 1 ? "" : "s"}`,
      body: failed
        ? str(p.error) ?? "Open the run to see what went wrong."
        : `${leads} new lead${leads === 1 ? "" : "s"} and ${signals} intent signal${signals === 1 ? "" : "s"}` +
          (p.status === "completed_with_errors" ? " (some steps had errors)" : ""),
      link: "/agents",
      entityType: "agent_run",
      entityId: p.runId,
      includeActor: true,
    };
  },

  "agent.run_failed": async (_orgId, p) => ({
    audience: p.actorId ? { userIds: [p.actorId] } : "managers",
    pref: "agentRunCompleted",
    type: "agent",
    title: "AI agent run failed",
    body: str(p.error) ?? str(p.message) ?? null,
    link: "/agents",
    entityType: "agent_run",
    entityId: p.runId ?? null,
    includeActor: true,
  }),

  "workflow.run_completed": async (orgId, p) => (p.status === "failed" ? workflowFailed(orgId, p) : null),
  "workflow.run_failed": async (orgId, p) => workflowFailed(orgId, p),

  "integration.status_changed": async (_orgId, p) =>
    p.status === "error"
      ? {
          audience: "admins",
          pref: "integrationError",
          type: "integration",
          title: `${p.provider} integration needs attention`,
          body: str(p.error),
          link: "/integrations",
          entityType: "integration",
          entityId: p.provider,
          includeActor: true,
        }
      : null,

  "member.joined": async (_orgId, p) => ({
    audience: "admins",
    type: "system",
    title: "A new member joined the workspace",
    body: p.role ? `Role: ${p.role}` : null,
    link: "/settings",
    entityType: "member",
    entityId: p.userId,
  }),
};

async function workflowFailed(orgId: string, p: Payload): Promise<Draft> {
  const workflow = await entity(orgId, "workflows", p.workflowId);
  return {
    audience: "managers",
    pref: "workflowFailed",
    type: "workflow",
    title: `Workflow failed: ${str(workflow?.name) ?? "workflow"}`,
    body: str(p.error) ?? null,
    link: "/workflows",
    entityType: "workflow",
    entityId: p.workflowId ?? null,
    includeActor: true,
  };
}

async function handle(event: DomainEvent): Promise<void> {
  const builder = BUILDERS[event.name as string];
  if (!builder) return;
  const payload = event.payload as Payload;
  if (!payload?.orgId) return;
  const drafts = await builder(payload.orgId, payload);
  if (!drafts) return;
  for (const draft of Array.isArray(drafts) ? drafts : [drafts]) {
    await notify(payload.orgId, payload.actorId ?? null, draft);
  }
}

let subscribed = false;

/** Feeds notifications from the event bus. Handlers are keyed by name so events added later are picked up. */
export function subscribeNotifications(): void {
  if (subscribed) return;
  subscribed = true;
  events.onAny((event) => handle(event));
}

subscribeNotifications();
