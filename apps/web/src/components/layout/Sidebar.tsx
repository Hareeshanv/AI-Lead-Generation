"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Users,
  Building2,
  Contact,
  Megaphone,
  Bot,
  GitFork,
  BarChart3,
  FileText,
  Mail,
  Kanban,
  Puzzle,
  Bell,
  Settings,
  Shield,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { useAuthStore } from "@/stores/useAuthStore";

const navigationItems = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Leads", href: "/leads", icon: Users, badge: "96" },
  { name: "Companies", href: "/companies", icon: Building2 },
  { name: "Contacts", href: "/contacts", icon: Contact },
  { name: "Campaigns", href: "/campaigns", icon: Megaphone },
  { name: "AI Agents", href: "/agents", icon: Bot, badge: "14 Live", isHighlight: true },
  { name: "Workflows", href: "/workflows", icon: GitFork },
  { name: "Analytics", href: "/analytics", icon: BarChart3 },
  { name: "Reports", href: "/reports", icon: FileText },
  { name: "Email", href: "/email", icon: Mail },
  { name: "CRM Pipeline", href: "/crm", icon: Kanban },
  { name: "Integrations", href: "/integrations", icon: Puzzle },
  { name: "Notifications", href: "/notifications", icon: Bell },
  { name: "Settings", href: "/settings", icon: Settings },
  { name: "Admin Panel", href: "/admin", icon: Shield },
];

export const Sidebar: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const { user, logout } = useAuthStore();

  return (
    <aside
      className={cn(
        "relative flex flex-col h-screen glass-panel border-r border-border transition-all duration-300 z-30 select-none",
        collapsed ? "w-20" : "w-64"
      )}
    >
      {/* Brand Header */}
      <div className="flex items-center justify-between h-16 px-4 border-b border-border">
        <Link href="/dashboard" className="flex items-center gap-3 overflow-hidden">
          <div className="p-2 rounded-xl bg-gradient-to-tr from-primary via-indigo-500 to-cyan-400 text-white shadow-lg shadow-primary/30 flex items-center justify-center">
            <Sparkles className="w-5 h-5 animate-pulse" />
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="font-bold text-base tracking-tight text-foreground leading-none">
                AI LeadGen <span className="text-primary font-mono text-xs">PRO</span>
              </span>
              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                Enterprise Autonomous
              </span>
            </div>
          )}
        </Link>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation List */}
      <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {navigationItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all group relative",
                isActive
                  ? "bg-primary text-white shadow-md shadow-primary/25"
                  : "text-muted-foreground hover:text-foreground hover:bg-card/60"
              )}
            >
              <div className="flex items-center gap-3">
                <Icon className={cn("w-5 h-5 transition-transform group-hover:scale-110", isActive && "text-white")} />
                {!collapsed && <span>{item.name}</span>}
              </div>
              {!collapsed && item.badge && (
                <span
                  className={cn(
                    "text-[10px] font-semibold px-2 py-0.5 rounded-full border",
                    item.isHighlight
                      ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30 animate-pulse"
                      : isActive
                      ? "bg-white/20 text-white border-transparent"
                      : "bg-muted text-muted-foreground border-border"
                  )}
                >
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* User Footer */}
      <div className="p-3 border-t border-border">
        <div className="flex items-center justify-between p-2 rounded-xl bg-card/40 border border-border/50">
          <div className="flex items-center gap-3 overflow-hidden">
            <img
              src={user?.avatar}
              alt={user?.name}
              className="w-9 h-9 rounded-full object-cover border border-primary/40"
            />
            {!collapsed && (
              <div className="flex flex-col truncate">
                <span className="text-xs font-semibold text-foreground truncate">{user?.name}</span>
                <span className="text-[10px] text-muted-foreground truncate">{user?.email}</span>
              </div>
            )}
          </div>
          {!collapsed && (
            <button
              onClick={logout}
              title="Logout"
              className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};
