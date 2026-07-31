"use client";

import React, { useState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Search, Bell, Sun, Moon, Sparkles, Command, Plus, ShieldCheck } from "lucide-react";
import { useThemeStore } from "@/stores/useThemeStore";
import { useNotificationStore } from "@/stores/useNotificationStore";
import Link from "next/link";

export const Header: React.FC = () => {
  const { theme, toggleTheme } = useThemeStore();
  const { notifications } = useNotificationStore();
  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <header className="h-16 px-6 glass-panel border-b border-border flex items-center justify-between sticky top-0 z-20">
      {/* Global Search Bar */}
      <div className="flex items-center gap-4 w-full max-w-md">
        <Input
          icon={<Search className="w-4 h-4" />}
          placeholder="Search leads, companies, AI agent runs... (Ctrl+K)"
          className="bg-card/40 border-border/70"
        />
      </div>

      {/* Action Controls & Indicators */}
      <div className="flex items-center gap-3">
        {/* Quick Agent Trigger */}
        <Link href="/agents">
          <Button variant="glass" size="sm" className="hidden sm:flex">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            Run Agent Pipeline
          </Button>
        </Link>

        {/* System Health Badge */}
        <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          14 Agents Active
        </div>

        {/* Notifications Button */}
        <Link href="/notifications" className="relative">
          <Button variant="ghost" size="icon" aria-label="Notifications">
            <Bell className="w-4 h-4 text-muted-foreground" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-primary animate-pulse" />
            )}
          </Button>
        </Link>

        {/* Dark/Light Theme Toggle */}
        <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
          {theme === "dark" ? (
            <Sun className="w-4 h-4 text-amber-400" />
          ) : (
            <Moon className="w-4 h-4 text-indigo-400" />
          )}
        </Button>
      </div>
    </header>
  );
};
