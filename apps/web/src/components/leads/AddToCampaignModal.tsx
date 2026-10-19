"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Megaphone } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { QueryState } from "@/components/ui/QueryState";
import { useAddLeadsToCampaign, useCampaigns } from "@/hooks/useCampaigns";
import { cn } from "@/lib/utils";

/** Adds leads to a campaign via POST /api/campaigns/:id/leads (owned by the Campaigns module). */
export const AddToCampaignModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  leadIds: string[];
  onDone?: () => void;
}> = ({ isOpen, onClose, leadIds, onDone }) => {
  const campaigns = useCampaigns({ pageSize: 100 }, { enabled: isOpen });
  const addLeads = useAddLeadsToCampaign();
  const [campaignId, setCampaignId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setCampaignId(null);
      addLeads.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const submit = async () => {
    if (!campaignId) return;
    try {
      await addLeads.mutateAsync({ id: campaignId, leadIds });
      onDone?.();
      onClose();
    } catch {
      // useApiMutation showed the error (including a 404 if the campaign endpoint is unavailable).
    }
  };

  const count = leadIds.length;
  return (
    <Modal
      isOpen={isOpen}
      onClose={() => !addLeads.isPending && onClose()}
      title={`Add ${count} lead${count === 1 ? "" : "s"} to a campaign`}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={addLeads.isPending}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} isLoading={addLeads.isPending} disabled={!campaignId}>
            Add to campaign
          </Button>
        </>
      }
    >
      <QueryState
        query={{ ...campaigns, data: campaigns.data?.data.filter((c) => c.status !== "completed") }}
        errorTitle="Couldn't load campaigns"
        empty={{
          icon: Megaphone,
          title: "No open campaigns",
          description: "Create a campaign first, then add leads to it.",
          action: (
            <Link href="/campaigns" className="text-sm text-primary hover:underline">
              Go to campaigns
            </Link>
          ),
        }}
      >
        {(list) => (
          <div className="space-y-2" role="radiogroup" aria-label="Campaign">
            {list.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={campaignId === c.id}
                onClick={() => setCampaignId(c.id)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                  campaignId === c.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground">{c.name}</span>
                  <span className="text-[11px] capitalize text-muted-foreground">
                    {c.channel === "whatsapp" ? "WhatsApp" : "Email"} · {c.status}
                  </span>
                </span>
              </button>
            ))}
            <p className="pt-1 text-[11px] text-muted-foreground">
              Leads marked do-not-contact, without consent for the channel, or unsubscribed are excluded by the campaign.
            </p>
          </div>
        )}
      </QueryState>
    </Modal>
  );
};
