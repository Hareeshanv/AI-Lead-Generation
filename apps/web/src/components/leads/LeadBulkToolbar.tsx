"use client";

import React from "react";
import { Briefcase, Megaphone, RefreshCw, Tag, Trash2, Users, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { BulkLeadDialogKind } from "./LeadDialogs";

export const LeadBulkToolbar: React.FC<{
  count: number;
  isManager: boolean;
  onOpenDialog: (dialog: BulkLeadDialogKind | "campaign") => void;
  onRescore: () => void;
  isRescoring: boolean;
  onCreateDeals: () => void;
  isCreatingDeals: boolean;
  onClear: () => void;
}> = ({ count, isManager, onOpenDialog, onRescore, isRescoring, onCreateDeals, isCreatingDeals, onClear }) => (
  <div
    role="toolbar"
    aria-label="Bulk actions"
    className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-card/95 px-4 py-2 shadow-sm backdrop-blur"
  >
    <span className="text-sm font-medium text-foreground mr-1">{count} selected</span>
    <Button variant="outline" size="sm" onClick={() => onOpenDialog("assign")}>
      <Users className="w-3.5 h-3.5" /> Assign
    </Button>
    <Button variant="outline" size="sm" onClick={() => onOpenDialog("status")}>
      Status
    </Button>
    <Button variant="outline" size="sm" onClick={() => onOpenDialog("tag")}>
      <Tag className="w-3.5 h-3.5" /> Tag
    </Button>
    <Button variant="outline" size="sm" onClick={() => onOpenDialog("untag")}>
      Untag
    </Button>
    {isManager && (
      <Button variant="outline" size="sm" onClick={() => onOpenDialog("campaign")}>
        <Megaphone className="w-3.5 h-3.5" /> Add to campaign
      </Button>
    )}
    <Button variant="outline" size="sm" isLoading={isCreatingDeals} onClick={onCreateDeals}>
      <Briefcase className="w-3.5 h-3.5" /> Create deals
    </Button>
    <Button variant="outline" size="sm" isLoading={isRescoring} onClick={onRescore}>
      <RefreshCw className="w-3.5 h-3.5" /> Rescore
    </Button>
    {isManager && (
      <Button variant="outline" size="sm" onClick={() => onOpenDialog("delete")} className="text-rose-600 hover:text-rose-600">
        <Trash2 className="w-3.5 h-3.5" /> Delete
      </Button>
    )}
    <Button variant="ghost" size="sm" className="ml-auto" onClick={onClear}>
      <X className="w-3.5 h-3.5" /> Clear
    </Button>
  </div>
);
