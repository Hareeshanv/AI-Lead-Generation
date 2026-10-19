"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { useLeadsRealtime } from "@/hooks/useLeads";
import { useMe } from "@/hooks/useMe";
import { useNotificationsRealtime } from "@/hooks/useNotifications";
import { signOut } from "@/lib/auth";
import { Spinner } from "@/components/ui/LoadingSkeleton";
import { ErrorState } from "@/components/ui/QueryState";
import { Button } from "@/components/ui/Button";
import { PendingInvitationsBanner } from "@/components/settings/WorkspaceInvitations";

/** Tailwind's md breakpoint, where the sidebar stops being a drawer. */
const DESKTOP_QUERY = "(min-width: 768px)";

export const DashboardLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const meQuery = useMe();
  const orgId = meQuery.data?.organization.id;
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);

  useLeadsRealtime(orgId);

  // New-lead (and other) notifications are created server-side from domain events; realtime refreshes the bell.
  useNotificationsRealtime(meQuery.data?.user.id, orgId);

  useEffect(() => {
    const desktop = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => desktop.matches && setMobileNavOpen(false);
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, []);

  if (meQuery.isLoading) {
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-background">
        <Spinner label="Loading your workspace…" />
      </div>
    );
  }

  if (meQuery.isError || !meQuery.data) {
    return (
      <div className="flex h-dvh w-full flex-col items-center justify-center gap-4 bg-background px-4">
        <ErrorState
          title="Couldn't load your workspace"
          error={meQuery.error}
          onRetry={() => void meQuery.refetch()}
          className="w-full max-w-md"
        />
        <Button variant="ghost" size="sm" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
      {mobileNavOpen && <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={closeMobileNav} aria-hidden="true" />}
      <Sidebar mobileOpen={mobileNavOpen} onMobileClose={closeMobileNav} />
      <div className="flex min-w-0 flex-col flex-1 h-full overflow-hidden">
        <Header onOpenNav={() => setMobileNavOpen(true)} navOpen={mobileNavOpen} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 space-y-6">
          <PendingInvitationsBanner />
          {children}
        </main>
      </div>
    </div>
  );
};
