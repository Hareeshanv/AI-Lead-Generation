export type NotificationType = "lead" | "deal" | "campaign" | "agent" | "workflow" | "integration" | "task" | "system";

/** A persisted notification from GET /api/notifications (always the signed-in user's own). */
export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  /** In-app path to open, e.g. "/leads/<id>". */
  link: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListParams {
  page?: number;
  pageSize?: number;
  unread?: boolean;
  type?: NotificationType;
}
