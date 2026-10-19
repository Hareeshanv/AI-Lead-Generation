import { dbClient } from "../client";
import { dbError, type PageResult } from "../helpers";

export type NotificationType = "lead" | "deal" | "campaign" | "agent" | "workflow" | "integration" | "task" | "system";

export interface NotificationRow {
  id: string;
  org_id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

export interface NewNotification {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}

export interface NotificationListFilter {
  unreadOnly?: boolean;
  type?: NotificationType;
  from: number;
  to: number;
}

export type EntityKind = "leads" | "deals" | "campaigns" | "workflows";

/** Owned by the Notifications module. Every query is scoped to (orgId, userId). */
export const notificationsDb = {
  async insertMany(orgId: string, items: NewNotification[]): Promise<NotificationRow[]> {
    if (items.length === 0) return [];
    const { data, error } = await dbClient
      .from("notifications")
      .insert(
        items.map((n) => ({
          org_id: orgId,
          user_id: n.userId,
          type: n.type,
          title: n.title.slice(0, 300),
          body: n.body ? n.body.slice(0, 2000) : null,
          link: n.link ?? null,
          entity_type: n.entityType ?? null,
          entity_id: n.entityId ?? null,
        }))
      )
      .select();
    if (error) throw dbError("insert notifications", error);
    return (data || []) as NotificationRow[];
  },

  async list(orgId: string, userId: string, filter: NotificationListFilter): Promise<PageResult<NotificationRow>> {
    let query = dbClient
      .from("notifications")
      .select("*", { count: "exact" })
      .eq("org_id", orgId)
      .eq("user_id", userId);
    if (filter.unreadOnly) query = query.is("read_at", null);
    if (filter.type) query = query.eq("type", filter.type);
    const { data, error, count } = await query.order("created_at", { ascending: false }).range(filter.from, filter.to);
    if (error) throw dbError("list notifications", error);
    return { rows: (data || []) as NotificationRow[], total: count ?? 0 };
  },

  async unreadCount(orgId: string, userId: string): Promise<number> {
    const { count, error } = await dbClient
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .is("read_at", null);
    if (error) throw dbError("count unread notifications", error);
    return count ?? 0;
  },

  /** Marks the given ids (or every unread notification when ids is omitted) as read. Returns the count. */
  async markRead(orgId: string, userId: string, ids?: string[]): Promise<number> {
    let query = dbClient
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .is("read_at", null);
    if (ids) {
      if (ids.length === 0) return 0;
      query = query.in("id", ids);
    }
    const { data, error } = await query.select("id");
    if (error) throw dbError("mark notifications read", error);
    return (data || []).length;
  },

  async remove(orgId: string, userId: string, id: string): Promise<boolean> {
    const { data, error } = await dbClient
      .from("notifications")
      .delete()
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .eq("id", id)
      .select("id");
    if (error) throw dbError("delete notification", error);
    return (data || []).length > 0;
  },

  /** Deletes all (or only read) notifications. Returns the count. */
  async clear(orgId: string, userId: string, options: { readOnly?: boolean } = {}): Promise<number> {
    let query = dbClient.from("notifications").delete().eq("org_id", orgId).eq("user_id", userId);
    if (options.readOnly) query = query.not("read_at", "is", null);
    const { data, error } = await query.select("id");
    if (error) throw dbError("clear notifications", error);
    return (data || []).length;
  },

  /** notification_prefs per user id (missing profiles are omitted). */
  async getPrefs(userIds: string[]): Promise<Map<string, Record<string, unknown>>> {
    if (userIds.length === 0) return new Map();
    const { data, error } = await dbClient.from("profiles").select("id, notification_prefs").in("id", userIds);
    if (error) throw dbError("get notification prefs", error);
    return new Map((data || []).map((p: any) => [p.id as string, (p.notification_prefs || {}) as Record<string, unknown>]));
  },

  /** A row used to word a notification (name/title, owner, creator). Null when not found. */
  async getEntity(orgId: string, kind: EntityKind, id: string): Promise<Record<string, any> | null> {
    const { data, error } = await dbClient.from(kind).select("*").eq("org_id", orgId).eq("id", id).maybeSingle();
    if (error) throw dbError(`get ${kind} for notification`, error);
    return data;
  },
};
