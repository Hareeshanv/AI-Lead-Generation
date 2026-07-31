"use client";

import React from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useNotificationStore } from "@/stores/useNotificationStore";
import { Bell, Check, Trash2 } from "lucide-react";

export default function NotificationsPage() {
  const { notifications, markAsRead, clearAll } = useNotificationStore();

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Notifications & Audit Alerts</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Real-time telemetry alerts from autonomous agent runs</p>
        </div>
        <Button variant="outline" size="sm" onClick={clearAll}>
          <Trash2 className="w-4 h-4 mr-1.5" /> Clear All
        </Button>
      </div>

      <div className="space-y-3">
        {notifications.map((notif) => (
          <Card key={notif.id} glass className={`p-4 flex items-center justify-between ${!notif.read && "border-primary/40"}`}>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-primary/10 text-primary">
                <Bell className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">{notif.title}</h3>
                <p className="text-xs text-muted-foreground">{notif.message}</p>
                <span className="text-[10px] text-muted-foreground mt-1 inline-block">{notif.timestamp}</span>
              </div>
            </div>
            {!notif.read && (
              <Button variant="ghost" size="sm" onClick={() => markAsRead(notif.id)}>
                <Check className="w-4 h-4 mr-1" /> Mark Read
              </Button>
            )}
          </Card>
        ))}
      </div>
    </DashboardLayout>
  );
}
