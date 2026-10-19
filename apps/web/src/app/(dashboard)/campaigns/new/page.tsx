"use client";

import React from "react";
import { Megaphone } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/QueryState";
import { CampaignWizard } from "@/components/campaigns/CampaignWizard";
import { useHasRole, useMe } from "@/hooks";

export default function NewCampaignPage() {
  const me = useMe();
  const canManage = useHasRole("manager");

  return (
    <div className="space-y-6">
      <PageHeader title="New campaign" description="Choose a channel, audience and message sequence." icon={Megaphone} />
      {me.isLoading ? (
        <LoadingState rows={4} />
      ) : canManage ? (
        <CampaignWizard />
      ) : (
        <EmptyState icon={Megaphone} title="Managers only" description="Ask a workspace manager or admin to create campaigns." />
      )}
    </div>
  );
}
