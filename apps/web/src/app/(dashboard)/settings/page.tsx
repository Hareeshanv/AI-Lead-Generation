"use client";

import React, { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Settings } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { QueryState } from "@/components/ui/QueryState";
import { ProfileSettings } from "@/components/settings/ProfileSettings";
import { WorkspaceSettings } from "@/components/settings/WorkspaceSettings";
import { MembersSettings } from "@/components/settings/MembersSettings";
import { NotificationSettings } from "@/components/settings/NotificationSettings";
import { useMe } from "@/hooks/useMe";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "profile", label: "Profile" },
  { id: "workspace", label: "Workspace" },
  { id: "members", label: "Members" },
  { id: "notifications", label: "Notifications" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function SettingsContent() {
  const meQuery = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get("tab");
  const tab: TabId = TABS.some((t) => t.id === requested) ? (requested as TabId) : "profile";

  return (
    <>
      <PageHeader title="Settings" description="Manage your profile, workspace and team." icon={Settings} />

      <div role="tablist" aria-label="Settings sections" className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => router.replace(`${pathname}?tab=${t.id}`, { scroll: false })}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <QueryState query={meQuery}>
        {(me) => (
          <div role="tabpanel">
            {tab === "profile" && <ProfileSettings me={me} />}
            {tab === "workspace" && <WorkspaceSettings />}
            {tab === "members" && <MembersSettings me={me} />}
            {tab === "notifications" && <NotificationSettings me={me} />}
          </div>
        )}
      </QueryState>
    </>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  );
}
