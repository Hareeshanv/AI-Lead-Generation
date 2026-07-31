import { create } from "zustand";
import { NotificationItem } from "@/types";
import { mockNotifications } from "@/lib/mockData";

interface NotificationState {
  notifications: NotificationItem[];
  markAsRead: (id: string) => void;
  clearAll: () => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: mockNotifications,
  markAsRead: (id) =>
    set((state) => ({
      notifications: state.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
    })),
  clearAll: () => set({ notifications: [] }),
}));
