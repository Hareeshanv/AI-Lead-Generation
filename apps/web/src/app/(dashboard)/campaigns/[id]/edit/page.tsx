"use client";

import React from "react";
import { useParams } from "next/navigation";
import { Megaphone } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState, QueryState } from "@/components/ui/QueryState";
import { CampaignWizard } from "@/components/campaigns/CampaignWizard";
import { useCampaign, useHasRole, useMe } from "@/hooks";

export default function EditCampaignPage() {
  const params = useParams<{ id: string }>();
  const query = useCampaign(params.id);
  const me = useMe();
  const canManage = useHasRole("manager");

  return (
    <div className="space-y-6">
      <PageHeader title="Edit campaign" description={query.data?.name} icon={Megaphone} />
      {me.isLoading ? (
        <LoadingState rows={4} />
      ) : !canManage ? (
        <EmptyState icon={Megaphone} title="Managers only" description="Ask a workspace manager or admin to edit campaigns." />
      ) : (
        <QueryState query={query} errorTitle="Couldn't load this campaign">
          {(campaign) =>
            campaign.status === "completed" ? (
              <EmptyState icon={Megaphone} title="Campaign completed" description="Completed campaigns can't be edited. Create a new campaign instead." />
            ) : (
              <CampaignWizard key={campaign.id} initial={campaign} />
            )
          }
        </QueryState>
      )}
    </div>
  );
}
