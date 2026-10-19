import { useEffect } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { notificationApi } from "@/services/api";
import { getSupabase } from "@/lib/supabase/client";
import type { NotificationListParams } from "@/types";
import { queryKeys } from "./queryKeys";
import { useApiMutation } from "./useApiMutation";

const listKey = (params: NotificationListParams) => [...queryKeys.notifications.all, "list", params] as const;
const unreadKey = [...queryKeys.notifications.all, "unread-count"] as const;

export function useNotifications(params: NotificationListParams) {
  return useQuery({
    queryKey: listKey(params),
    queryFn: () => notificationApi.list(params),
    placeholderData: keepPreviousData,
  });
}

/** Unread badge count; realtime keeps it fresh, the interval is a fallback when realtime is unavailable. */
export function useUnreadNotificationCount(enabled = true) {
  return useQuery({
    queryKey: unreadKey,
    queryFn: notificationApi.unreadCount,
    enabled,
    refetchInterval: 120_000,
  });
}

/**
 * Listens for this user's notification rows over Supabase Realtime and refreshes the notification
 * queries. Rows are never read from the table directly; the API stays the source of truth.
 */
export function useNotificationsRealtime(userId: string | undefined, orgId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId || !orgId) return;
    const supabase = getSupabase();
    const channel = supabase
      .channel(`notifications:${userId}:${orgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = (payload.new ?? {}) as { org_id?: string; title?: string; body?: string | null };
          if (payload.eventType === "INSERT" && row.org_id === orgId && row.title) {
            toast(row.title, row.body ? { description: row.body } : undefined);
          }
          void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, orgId, queryClient]);
}

export function useMarkNotificationRead() {
  return useApiMutation<unknown, string>({
    mutationFn: notificationApi.markRead,
    invalidate: [queryKeys.notifications.all],
  });
}

export function useMarkAllNotificationsRead() {
  return useApiMutation<{ updated: number }, void>({
    mutationFn: () => notificationApi.markAllRead(),
    invalidate: [queryKeys.notifications.all],
    successMessage: (r) => (r.updated > 0 ? `Marked ${r.updated} notification${r.updated === 1 ? "" : "s"} as read` : null),
  });
}

export function useDeleteNotification() {
  return useApiMutation<void, string>({
    mutationFn: notificationApi.remove,
    invalidate: [queryKeys.notifications.all],
  });
}

export function useClearNotifications() {
  return useApiMutation<void, { readOnly?: boolean }>({
    mutationFn: ({ readOnly }) => notificationApi.clear(readOnly),
    invalidate: [queryKeys.notifications.all],
    successMessage: (_r, v) => (v.readOnly ? "Read notifications cleared" : "All notifications cleared"),
  });
}
