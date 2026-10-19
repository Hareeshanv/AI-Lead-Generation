"use client";

import React, { useEffect, useState } from "react";
import { FlaskConical, Search } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { LoadingState, ErrorState } from "@/components/ui/QueryState";
import { useTestWorkflow, useWorkflowSubjects } from "@/hooks";
import { errorMessage } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { Workflow, WorkflowRun } from "@/types";
import { triggerMeta } from "./catalog";
import { ConditionTraceView, RunStatusBadge, StepList } from "./RunDetails";

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export const TestWorkflowDialog: React.FC<{ workflow: Workflow | null; onClose: () => void }> = ({ workflow, onClose }) => {
  const subjects = workflow
    ? workflow.trigger.type === "schedule"
      ? workflow.trigger.scope === "leads"
        ? ["lead"]
        : []
      : triggerMeta(workflow.trigger.type)?.subjects ?? []
    : [];
  const kind: "lead" | "deal" | null = subjects.includes("deal") ? "deal" : subjects.includes("lead") ? "lead" : null;

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<WorkflowRun | null>(null);
  const q = useDebounced(search.trim(), 300);
  const options = useWorkflowSubjects(kind ?? "lead", q, !!workflow && !!kind);
  const test = useTestWorkflow();

  useEffect(() => {
    setSearch("");
    setSelected(null);
    setResult(null);
    test.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow?.id]);

  if (!workflow) return null;

  const run = () => {
    setResult(null);
    test.mutate(
      { id: workflow.id, input: kind === "deal" ? { dealId: selected } : kind === "lead" ? { leadId: selected } : {} },
      { onSuccess: (r) => setResult(r) }
    );
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Test "${workflow.name}"`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={run} isLoading={test.isPending} disabled={!!kind && !selected}>
            <FlaskConical className="w-4 h-4" /> Run test
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          A dry run checks the conditions and previews every action against real data. Nothing is changed, sent or
          notified; the run is saved to history marked as a test.
        </p>

        {kind && (
          <div className="space-y-2">
            <Input
              icon={<Search className="w-4 h-4" />}
              placeholder={kind === "deal" ? "Search deals" : "Search leads"}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={kind === "deal" ? "Search deals" : "Search leads"}
            />
            <div className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border">
              {options.isLoading ? (
                <LoadingState rows={2} className="p-2" />
              ) : options.isError ? (
                <ErrorState error={options.error} onRetry={() => void options.refetch()} className="border-0 py-4" />
              ) : (options.data ?? []).length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">No {kind === "deal" ? "deals" : "leads"} found.</p>
              ) : (
                options.data!.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setSelected(o.id)}
                    className={cn(
                      "w-full text-left px-3 py-2 text-xs hover:bg-muted/40",
                      selected === o.id && "bg-primary/10 text-foreground"
                    )}
                    aria-pressed={selected === o.id}
                  >
                    <span className="font-medium text-foreground">{o.label}</span>
                    {o.detail && <span className="ml-2 text-muted-foreground">{o.detail}</span>}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
        {!kind && <p className="text-xs text-muted-foreground">This trigger has no lead or deal; the test uses a sample event.</p>}

        {test.isError && (
          <p className="text-sm text-destructive" role="alert">
            {errorMessage(test.error)}
          </p>
        )}

        {result && (
          <div className="space-y-3 rounded-lg border border-border p-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-foreground">Result</span>
              <RunStatusBadge status={result.status} />
              {result.status === "skipped" && <span className="text-xs text-muted-foreground">Conditions didn&apos;t match</span>}
            </div>
            <div className="space-y-1">
              <h4 className="text-xs font-semibold text-foreground">Conditions</h4>
              <ConditionTraceView trace={result.conditions} />
            </div>
            {result.status !== "skipped" && (
              <div className="space-y-1">
                <h4 className="text-xs font-semibold text-foreground">Actions</h4>
                <StepList steps={result.steps} />
              </div>
            )}
            {result.error && result.status === "failed" && <p className="text-xs text-destructive">{result.error}</p>}
          </div>
        )}
      </div>
    </Modal>
  );
};
