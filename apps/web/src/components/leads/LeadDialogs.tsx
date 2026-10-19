"use client";

import React, { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { smallSelectClassName, useMemberNames } from "@/components/crm/shared";
import { useBulkLeadAction, useDeleteLead } from "@/hooks/useLeads";
import { LEAD_STATUSES } from "@/lib/analytics";
import type { Lead, LeadStatus } from "@/types";

export type BulkLeadDialogKind = "assign" | "status" | "tag" | "untag" | "delete";

const TITLES: Record<BulkLeadDialogKind, string> = {
  assign: "Assign owner",
  status: "Change status",
  tag: "Add tags",
  untag: "Remove tags",
  delete: "Delete leads",
};

/** Confirms a bulk action on the selected leads; `onDone` runs after it succeeds. */
export const BulkLeadActionDialog: React.FC<{
  dialog: BulkLeadDialogKind | null;
  leadIds: string[];
  onClose: () => void;
  onDone: () => void;
}> = ({ dialog, leadIds, onClose, onDone }) => {
  const bulk = useBulkLeadAction();
  const { members, nameOf } = useMemberNames();
  const [owner, setOwner] = useState("");
  const [status, setStatus] = useState<LeadStatus>("Contacted");
  const [tagsText, setTagsText] = useState("");

  const run = async (action: Parameters<typeof bulk.mutateAsync>[0]) => {
    try {
      await bulk.mutateAsync(action);
      onClose();
      onDone();
    } catch {
      // toast shown
    }
  };

  const confirm = () => {
    const tags = tagsText.split(",").map((t) => t.trim()).filter(Boolean);
    switch (dialog) {
      case "assign":
        return run({ action: "assign", leadIds, ownerId: owner || null });
      case "status":
        return run({ action: "status", leadIds, status });
      case "tag":
      case "untag":
        if (tags.length === 0) return toast.error("Enter at least one tag.");
        return run({ action: dialog, leadIds, tags });
      case "delete":
        return run({ action: "delete", leadIds });
    }
  };

  return (
    <Modal
      isOpen={dialog !== null}
      onClose={() => !bulk.isPending && onClose()}
      title={dialog ? `${TITLES[dialog]} (${leadIds.length})` : ""}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={bulk.isPending}>
            Cancel
          </Button>
          <Button size="sm" variant={dialog === "delete" ? "destructive" : "primary"} onClick={() => void confirm()} isLoading={bulk.isPending}>
            {dialog === "delete" ? "Delete" : "Apply"}
          </Button>
        </>
      }
    >
      {dialog === "assign" && (
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
          New owner
          <select value={owner} onChange={(e) => setOwner(e.target.value)} className={smallSelectClassName}>
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {nameOf(m.userId)}
              </option>
            ))}
          </select>
        </label>
      )}
      {dialog === "status" && (
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
          New status
          <select value={status} onChange={(e) => setStatus(e.target.value as LeadStatus)} className={smallSelectClassName}>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      )}
      {(dialog === "tag" || dialog === "untag") && (
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
          Tags (comma separated)
          <Input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="e.g. webinar, priority" autoFocus />
        </label>
      )}
      {dialog === "delete" && (
        <p className="text-sm text-muted-foreground">
          Permanently delete {leadIds.length} lead{leadIds.length === 1 ? "" : "s"} with their activities and follow-ups? Linked deals are kept
          but unlinked. This cannot be undone.
        </p>
      )}
    </Modal>
  );
};

export const DeleteLeadDialog: React.FC<{ lead: Lead | null; onClose: () => void }> = ({ lead, onClose }) => {
  const deleteLead = useDeleteLead();

  const confirm = async () => {
    if (!lead) return;
    try {
      await deleteLead.mutateAsync(lead.id);
      onClose();
    } catch {
      // toast shown
    }
  };

  return (
    <Modal
      isOpen={lead !== null}
      onClose={() => !deleteLead.isPending && onClose()}
      title="Delete lead"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={deleteLead.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={() => void confirm()} isLoading={deleteLead.isPending}>
            Delete
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        Delete <span className="font-medium text-foreground">{lead?.name}</span>? This cannot be undone.
      </p>
    </Modal>
  );
};
