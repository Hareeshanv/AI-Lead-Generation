import { useCallback, useState } from "react";
import { toast } from "sonner";
import { leadApi } from "@/services/api";
import { csvFilename, downloadCsv, leadsToCsv } from "@/lib/csv";
import { errorMessage } from "@/lib/toast";
import type { Lead, LeadListParams } from "@/types";

/** Matches MAX_EXPORT_ROWS in apps/api/src/routes/exports.ts. */
export const LEAD_EXPORT_LIMIT = 10_000;

const plural = (n: number) => `${n.toLocaleString()} lead${n === 1 ? "" : "s"}`;

export type LeadExportSource =
  /** Leads already on screen (a selection or AI search results); exported as-is. */
  | { kind: "loaded"; leads: Lead[]; label?: string }
  /** Every lead matching the list filters; built server-side. */
  | { kind: "filtered"; params: LeadListParams; total: number };

export function useLeadExport() {
  const [isExporting, setIsExporting] = useState(false);

  const exportLeads = useCallback(async (source: LeadExportSource) => {
    if (source.kind === "loaded") {
      downloadCsv(csvFilename("leads"), leadsToCsv(source.leads));
      toast.success(`Exported ${source.label ? `${source.leads.length} ${source.label}` : plural(source.leads.length)}.`);
      return;
    }
    setIsExporting(true);
    try {
      downloadCsv(csvFilename("leads"), await leadApi.exportCsv(source.params));
      const count = Math.min(source.total, LEAD_EXPORT_LIMIT);
      toast.success(`Exported ${plural(count)}${source.total > LEAD_EXPORT_LIMIT ? ` (first ${LEAD_EXPORT_LIMIT.toLocaleString()})` : ""}.`);
    } catch (err) {
      toast.error(`Export failed: ${errorMessage(err)}`);
    } finally {
      setIsExporting(false);
    }
  }, []);

  return { exportLeads, isExporting };
}
