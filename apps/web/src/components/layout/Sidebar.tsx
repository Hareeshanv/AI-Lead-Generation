"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Users,
  Megaphone,
  Bot,
  GitFork,
  BarChart3,
  Kanban,
  Puzzle,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { useMe } from "@/hooks/useMe";
import { signOut } from "@/lib/auth";
import { useLeadCount } from "@/hooks/useLeads";

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

const navigationSections: NavSection[] = [
  {
    title: "Core",
    items: [
      { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { name: "Leads", href: "/leads", icon: Users },
      { name: "CRM Pipeline", href: "/crm", icon: Kanban },
      { name: "Campaigns", href: "/campaigns", icon: Megaphone },
    ],
  },
  {
    title: "Automation",
    items: [
      { name: "AI Agents", href: "/agents", icon: Bot },
      { name: "Workflows", href: "/workflows", icon: GitFork },
      { name: "Analytics", href: "/analytics", icon: BarChart3 },
    ],
  },
  {
    title: "System",
    items: [
      { name: "Integrations", href: "/integrations", icon: Puzzle },
      { name: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

export const Sidebar: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const pathname = usePathname();
  const { data: me } = useMe();
  const user = me?.user;
  const displayName = user?.fullName || user?.email || "User";
  const leadCount = useLeadCount().data ?? 0;

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  const handleLogout = () => {
    void signOut();
  };

  return (
    <aside
      className={cn(
        "relative flex flex-col h-screen glass-panel border-r border-border transition-all duration-300 z-30 select-none",
        collapsed ? "w-20" : "w-64"
      )}
    >
      <div className="flex items-center justify-between h-16 px-4 border-b border-border">
        <Link href="/dashboard" className="flex items-center gap-3 overflow-hidden">
          <div className="p-2 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
            <Sparkles className="w-4 h-4" />
          </div>
          {!collapsed && <span className="font-semibold text-base tracking-tight text-foreground">AI LeadGen</span>}
        </Link>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-4">
        {navigationSections.map((section, sIdx) => (
          <div key={section.title || sIdx} className="space-y-1">
            {!collapsed && section.title && (
              <div className="px-3 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground/70 uppercase">
                {section.title}
              </div>
            )}
            {collapsed && sIdx > 0 && <div className="my-2 border-t border-border/40" />}
            {section.items.map((item) => {
              const isActive = pendingHref
                ? pendingHref === item.href
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              const badge = item.href === "/leads" && leadCount > 0 ? leadCount.toLocaleString() : null;

              return (
                <Link
                  key={item.name}
                  href={item.href}
                  title={collapsed ? item.name : undefined}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                    if (item.href !== pathname) setPendingHref(item.href);
                  }}
                  className={cn(
                    "flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Icon className="w-[18px] h-[18px]" />
                    {!collapsed && <span>{item.name}</span>}
                  </div>
                  {!collapsed && badge && (
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="p-3 border-t border-border">
        <div className={cn("flex items-center p-2 rounded-lg", collapsed ? "justify-center" : "justify-between")}>
          <div className="flex items-center gap-3 overflow-hidden">
            <Avatar src={user?.avatarUrl || undefined} name={displayName} size="sm" />
            {!collapsed && (
              <div className="flex flex-col truncate">
                <span className="text-xs font-semibold text-foreground truncate">{displayName}</span>
                <span className="text-[11px] text-muted-foreground truncate">{me?.organization.name}</span>
              </div>
            )}
          </div>
          {!collapsed && (
            <button
              onClick={handleLogout}
              title="Log out"
              aria-label="Log out"
              className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};
