"use client";

import React, { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useNotificationStore } from "@/stores/useNotificationStore";
import { Bell, Check, Trash2, Sparkles, AlertCircle, Bot, CheckCircle2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

export default function NotificationsPage() {
  const { notifications, markAsRead, clearAll } = useNotificationStore();
  const [filter, setFilter] = useState<"all" | "unread" | "high">("all");

  const filteredNotifs = notifications.filter((n) => {
    if (filter === "unread") return !n.read;
    if (filter === "high") return n.title.toLowerCase().includes("hot") || n.title.toLowerCase().includes("alert");
    return true;
  });

  const handleMarkAllRead = () => {
    notifications.forEach((n) => markAsRead(n.id));
    toast.success("All notifications marked as read.");
  };

  const handleClearAll = () => {
    clearAll();
    toast.info("Notifications cleared.");
  };

  return (
    <DashboardLayout>
      {/* Top Banner Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass-panel p-6 rounded-2xl border border-white/10">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            Notifications & Audit Alerts <Sparkles className="w-5 h-5 text-indigo-400 animate-pulse" />
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Real-time telemetry, hot ICP prospect discoveries, and autonomous agent logs
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={handleMarkAllRead}>
            <CheckCircle2 className="w-4 h-4 mr-1.5" /> Mark All Read
          </Button>
          <Button variant="ghost" size="sm" className="text-rose-400 hover:bg-rose-500/10" onClick={handleClearAll}>
            <Trash2 className="w-4 h-4 mr-1.5" /> Clear All
          </Button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2">
        <Button
          variant={filter === "all" ? "primary" : "outline"}
          size="sm"
          className="text-xs"
          onClick={() => setFilter("all")}
        >
          All ({notifications.length})
        </Button>
        <Button
          variant={filter === "unread" ? "primary" : "outline"}
          size="sm"
          className="text-xs"
          onClick={() => setFilter("unread")}
        >
          Unread ({notifications.filter((n) => !n.read).length})
        </Button>
        <Button
          variant={filter === "high" ? "primary" : "outline"}
          size="sm"
          className="text-xs"
          onClick={() => setFilter("high")}
        >
          High Priority / ICP
        </Button>
      </div>

      {/* Notifications List */}
      <div className="space-y-3">
        {filteredNotifs.length === 0 ? (
          <Card glass className="p-12 text-center text-muted-foreground">
            <Bell className="w-8 h-8 mx-auto text-indigo-400/50 mb-2" />
            <p className="text-sm font-semibold">No notifications found in this view.</p>
          </Card>
        ) : (
          filteredNotifs.map((notif) => (
            <Card
              key={notif.id}
              glass
              className={`glass-panel-hover p-4 flex items-center justify-between transition-all ${
                !notif.read ? "border-primary/50 bg-indigo-500/5" : "border-white/5"
              }`}
            >
              <div className="flex items-center gap-3.5">
                <div
                  className={`p-2.5 rounded-xl ${
                    notif.title.toLowerCase().includes("hot")
                      ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                      : "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                  }`}
                >
                  {notif.title.toLowerCase().includes("hot") ? (
                    <AlertCircle className="w-5 h-5" />
                  ) : (
                    <Bot className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">{notif.title}</h3>
                    {!notif.read && (
                      <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{notif.message}</p>
                  <span className="text-[10px] text-muted-foreground font-mono mt-1 inline-block">
                    {notif.timestamp}
                  </span>
                </div>
              </div>

              {!notif.read && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => {
                    markAsRead(notif.id);
                    toast.success("Notification read.");
                  }}
                >
                  <Check className="w-4 h-4 mr-1" /> Mark Read
                </Button>
              )}
            </Card>
          ))
        )}
      </div>
    </DashboardLayout>
  );
}

