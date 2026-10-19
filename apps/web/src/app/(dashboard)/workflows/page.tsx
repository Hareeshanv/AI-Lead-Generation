"use client";

import React, { useEffect, useMemo, useState } from "react";
import { FlaskConical, GitFork, Pencil, Plus, Sparkles, Trash2, Zap, Filter, ListOrdered } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Modal } from "@/components/ui/Modal";
import { QueryState } from "@/components/ui/QueryState";
import { PageHeader } from "@/components/layout/PageHeader";
import { WorkflowBuilder } from "@/components/workflows/WorkflowBuilder";
import { RunHistory } from "@/components/workflows/RunHistory";
import { TestWorkflowDialog } from "@/components/workflows/TestWorkflowDialog";
import {
  OPERATORS,
  TEMPLATES,
  cleanDraft,
  describeAction,
  describeTrigger,
  emptyDraft,
  isRule,
  type WorkflowTemplate,
} from "@/components/workflows/catalog";
import {
  useCreateWorkflow,
  useDeleteWorkflow,
  useHasRole,
  useSetWorkflowEnabled,
  useUpdateWorkflow,
  useWorkflows,
} from "@/hooks";
import { cn } from "@/lib/utils";
import type { ApiError } from "@/services/api/http";
import type { Workflow, WorkflowInput } from "@/types";

type View = { mode: "list" } | { mode: "create"; initial: WorkflowInput } | { mode: "edit"; workflow: Workflow };

const toInput = (wf: Workflow): WorkflowInput => ({
  name: wf.name,
  description: wf.description,
  enabled: wf.enabled,
  trigger: wf.trigger,
  conditions: wf.conditions?.rules ? wf.conditions : { op: "and", rules: [] },
  actions: wf.actions,
});

const EnableSwitch: React.FC<{ workflow: Workflow; disabled?: boolean }> = ({ workflow, disabled }) => {
  const setEnabled = useSetWorkflowEnabled();
  const on = workflow.enabled;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={on ? `Pause ${workflow.name}` : `Turn on ${workflow.name}`}
      disabled={disabled || setEnabled.isPending}
      onClick={(e) => {
        e.stopPropagation();
        setEnabled.mutate({ id: workflow.id, enabled: !on });
      }}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50",
        on ? "bg-primary border-primary" : "bg-muted border-border"
      )}
    >
      <span className={cn("inline-block h-4 w-4 rounded-full bg-white shadow transition-transform", on ? "translate-x-4" : "translate-x-0.5")} />
    </button>
  );
};

const TemplatePicker: React.FC<{ onPick: (t: WorkflowTemplate) => void }> = ({ onPick }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
    {TEMPLATES.map((t) => (
      <button
        key={t.id}
        type="button"
        onClick={() => onPick(t)}
        className="text-left rounded-xl border border-border bg-card p-4 hover:border-primary/50 hover:bg-muted/30 transition-colors"
      >
        <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-primary" /> {t.name}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
      </button>
    ))}
  </div>
);

const WorkflowSummary: React.FC<{ workflow: Workflow }> = ({ workflow }) => {
  const rules = workflow.conditions?.rules ?? [];
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-lg border border-border bg-background p-3">
        <Zap className="w-4 h-4 mt-0.5 text-primary shrink-0" />
        <div className="text-xs">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">When</p>
          <p className="text-foreground font-medium">{describeTrigger(workflow.trigger)}</p>
        </div>
      </div>
      <div className="flex items-start gap-3 rounded-lg border border-border bg-background p-3">
        <Filter className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
        <div className="text-xs space-y-0.5">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Only if {rules.length > 1 ? (workflow.conditions.op === "or" ? "(any)" : "(all)") : ""}
          </p>
          {rules.length === 0 && <p className="text-muted-foreground">Always</p>}
          {rules.map((r, i) =>
            isRule(r) ? (
              <p key={i} className="text-foreground">
                <code className="text-[11px]">{r.field}</code> {OPERATORS.find((o) => o.value === r.operator)?.label ?? r.operator}{" "}
                {r.value != null && String(r.value) !== "" && <strong>{Array.isArray(r.value) ? r.value.join(", ") : String(r.value)}</strong>}
              </p>
            ) : (
              <p key={i} className="text-muted-foreground">
                A nested group of {r.rules.length} condition(s)
              </p>
            )
          )}
        </div>
      </div>
      <div className="flex items-start gap-3 rounded-lg border border-border bg-background p-3">
        <ListOrdered className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
        <div className="text-xs space-y-0.5">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Then</p>
          <ol className="list-decimal pl-4 space-y-0.5 text-foreground">
            {workflow.actions.map((a, i) => (
              <li key={i}>{describeAction(a)}</li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
};

export default function WorkflowsPage() {
  const workflows = useWorkflows();
  const canManage = useHasRole("manager");
  const createWorkflow = useCreateWorkflow();
  const updateWorkflow = useUpdateWorkflow();
  const deleteWorkflow = useDeleteWorkflow();

  const [view, setView] = useState<View>({ mode: "list" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [testing, setTesting] = useState<Workflow | null>(null);
  const [deleting, setDeleting] = useState<Workflow | null>(null);

  const list = useMemo(() => workflows.data ?? [], [workflows.data]);
  const selected = list.find((w) => w.id === selectedId) ?? list[0] ?? null;

  useEffect(() => {
    if (!selectedId && list.length > 0) setSelectedId(list[0].id);
  }, [list, selectedId]);

  const startCreate = (initial: WorkflowInput) => {
    createWorkflow.reset();
    setShowTemplates(false);
    setView({ mode: "create", initial });
  };

  const save = (draft: WorkflowInput) => {
    const input = cleanDraft(draft);
    if (view.mode === "edit") {
      updateWorkflow.mutate(
        { id: view.workflow.id, patch: input },
        {
          onSuccess: (wf) => {
            setSelectedId(wf.id);
            setView({ mode: "list" });
          },
        }
      );
    } else {
      createWorkflow.mutate(input, {
        onSuccess: (wf) => {
          setSelectedId(wf.id);
          setView({ mode: "list" });
        },
      });
    }
  };

  if (view.mode !== "list") {
    const mutation = view.mode === "edit" ? updateWorkflow : createWorkflow;
    return (
      <>
        <PageHeader title="Workflows" description="Automate follow-ups, routing and alerts." icon={GitFork} />
        <WorkflowBuilder
          key={view.mode === "edit" ? view.workflow.id : "new"}
          title={view.mode === "edit" ? `Edit "${view.workflow.name}"` : "New workflow"}
          initial={view.mode === "edit" ? toInput(view.workflow) : view.initial}
          saving={mutation.isPending}
          serverErrors={(mutation.error as ApiError | null)?.fields}
          onSave={save}
          onCancel={() => setView({ mode: "list" })}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Workflows"
        description="Automate follow-ups, routing and alerts when leads, deals and campaigns change."
        icon={GitFork}
        actions={
          canManage && (
            <>
              <Button variant="outline" size="sm" onClick={() => setShowTemplates((s) => !s)}>
                <Sparkles className="w-3.5 h-3.5" /> Templates
              </Button>
              <Button size="sm" onClick={() => startCreate(emptyDraft())}>
                <Plus className="w-3.5 h-3.5" /> New workflow
              </Button>
            </>
          )
        }
      />

      {showTemplates && canManage && (
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Start from a template</h2>
          <TemplatePicker onPick={(t) => startCreate(t.build())} />
        </Card>
      )}

      <QueryState
        query={workflows}
        errorTitle="Couldn't load workflows"
        empty={{
          title: "No workflows yet",
          description: canManage
            ? "Pick a template below or build one from scratch."
            : "Ask a manager or admin to set up workflows.",
          icon: GitFork,
          action: canManage ? (
            <Button size="sm" onClick={() => startCreate(emptyDraft())}>
              <Plus className="w-3.5 h-3.5" /> New workflow
            </Button>
          ) : undefined,
        }}
      >
        {(rows) => (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="space-y-2">
              {rows.map((wf) => (
                <div
                  key={wf.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(wf.id)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSelectedId(wf.id)}
                  className={cn(
                    "rounded-xl border p-3 cursor-pointer transition-colors",
                    selected?.id === wf.id ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/30"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{wf.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{describeTrigger(wf.trigger)}</p>
                    </div>
                    <EnableSwitch workflow={wf} disabled={!canManage} />
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
                    <StatusBadge status={wf.status} />
                    <span>{wf.stats.totalRuns} runs</span>
                    {wf.stats.successRate != null && <span>{wf.stats.successRate}% ok</span>}
                  </div>
                </div>
              ))}
            </div>

            {selected && (
              <div className="lg:col-span-2 space-y-6">
                <Card className="space-y-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between border-b border-border pb-4">
                    <div className="min-w-0">
                      <h2 className="text-base font-medium text-foreground">{selected.name}</h2>
                      {selected.description && <p className="text-xs text-muted-foreground mt-0.5">{selected.description}</p>}
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {selected.stats.lastRunAt ? `Last ran ${new Date(selected.stats.lastRunAt).toLocaleString()}` : "Never run"}
                      </p>
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-2 shrink-0">
                        <Button variant="outline" size="sm" onClick={() => setTesting(selected)}>
                          <FlaskConical className="w-3.5 h-3.5" /> Test
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            updateWorkflow.reset();
                            setView({ mode: "edit", workflow: selected });
                          }}
                        >
                          <Pencil className="w-3.5 h-3.5" /> Edit
                        </Button>
                        <Button variant="ghost" size="sm" aria-label="Delete workflow" onClick={() => setDeleting(selected)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                  <WorkflowSummary workflow={selected} />
                </Card>
                <RunHistory workflowId={selected.id} />
              </div>
            )}
          </div>
        )}
      </QueryState>

      {!showTemplates && canManage && workflows.data && workflows.data.length === 0 && (
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Starter templates</h2>
          <TemplatePicker onPick={(t) => startCreate(t.build())} />
        </Card>
      )}

      <TestWorkflowDialog workflow={testing} onClose={() => setTesting(null)} />

      <Modal
        isOpen={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete workflow?"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              isLoading={deleteWorkflow.isPending}
              onClick={() =>
                deleting &&
                deleteWorkflow.mutate(deleting.id, {
                  onSuccess: () => {
                    if (selectedId === deleting.id) setSelectedId(null);
                    setDeleting(null);
                  },
                })
              }
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          &ldquo;{deleting?.name}&rdquo; and its run history will be removed. Runs waiting on a delay will not continue.
        </p>
      </Modal>
    </>
  );
}
