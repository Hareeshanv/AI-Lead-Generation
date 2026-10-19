"use client";

import React from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { useLeadsRealtime } from "@/hooks/useLeads";
import { useMe } from "@/hooks/useMe";
import { useNotificationsRealtime } from "@/hooks/useNotifications";
import { signOut } from "@/lib/auth";
import { Spinner } from "@/components/ui/LoadingSkeleton";
import { ErrorState } from "@/components/ui/QueryState";
import { Button } from "@/components/ui/Button";

export const DashboardLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const meQuery = useMe();
  const orgId = meQuery.data?.organization.id;

  useLeadsRealtime(orgId);

  // New-lead (and other) notifications are created server-side from domain events; realtime refreshes the bell.
  useNotificationsRealtime(meQuery.data?.user.id, orgId);

  if (meQuery.isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <Spinner label="Loading your workspace…" />
      </div>
    );
  }

  if (meQuery.isError || !meQuery.data) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background px-4">
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
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <div className="flex flex-col flex-1 h-full overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">{children}</main>
      </div>
    </div>
  );
};
