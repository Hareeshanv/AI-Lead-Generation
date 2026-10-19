import { deleteData, enc, getData, getPage, postData } from "./http";
import type { AppNotification, NotificationListParams, Paginated } from "@/types";

/** Owned by the Notifications module; always the signed-in user's own notifications. */
export const notificationApi = {
  list: (params: NotificationListParams = {}): Promise<Paginated<AppNotification>> =>
    getPage<AppNotification>("/notifications", { ...params }),
  unreadCount: async (): Promise<number> => (await getData<{ count: number }>("/notifications/unread-count")).count,
  markRead: (id: string) => postData<{ updated: number }>(`/notifications/${enc(id)}/read`),
  markAllRead: () => postData<{ updated: number }>("/notifications/read-all"),
  remove: (id: string) => deleteData(`/notifications/${enc(id)}`),
  /** Deletes all notifications, or only read ones. */
  clear: (readOnly = false) => deleteData(`/notifications${readOnly ? "?readOnly=true" : ""}`),
};
