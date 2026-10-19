"use client";

import React, { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ErrorState, LoadingState } from "@/components/ui/QueryState";
import { useCampaigns } from "@/hooks/useCampaigns";

export const CampaignPickerModal: React.FC<{
  isOpen: boolean;
  count: number;
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: (campaignId: string) => void;
}> = ({ isOpen, count, isSubmitting, onClose, onConfirm }) => {
  const campaigns = useCampaigns({ pageSize: 100 }, { enabled: isOpen });
  const openCampaigns = (campaigns.data?.data ?? []).filter((c) => c.status !== "completed");
  const [campaignId, setCampaignId] = useState("");

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add to campaign"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={() => campaignId && onConfirm(campaignId)} disabled={!campaignId} isLoading={isSubmitting}>
            Add {count} lead{count === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      {campaigns.isLoading ? (
        <LoadingState rows={2} />
      ) : campaigns.isError ? (
        <ErrorState title="Couldn't load campaigns" error={campaigns.error} onRetry={() => void campaigns.refetch()} />
      ) : openCampaigns.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open campaigns yet. Create one on the Campaigns page first.</p>
      ) : (
        <div className="space-y-2">
          <label htmlFor="campaign-picker" className="text-xs font-medium text-muted-foreground block">
            Campaign
          </label>
          <select
            id="campaign-picker"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            className="w-full h-10 px-3 rounded-lg bg-background border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="">Choose a campaign…</option>
            {openCampaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.status ? ` (${c.status})` : ""}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Selected intent signals are converted to leads first. Leads marked do-not-contact or without consent are excluded when the campaign launches.
          </p>
        </div>
      )}
    </Modal>
  );
};
