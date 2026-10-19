"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Field, fieldError, selectClassName } from "@/components/settings/shared";
import { useCreateDeal, useUpdateDeal } from "@/hooks/useDeals";
import { useMe } from "@/hooks/useMe";
import type { Deal, DealInput, DealStage } from "@/types";
import { OwnerSelect } from "./shared";

export const DEAL_STAGES: DealStage[] = ["New", "Qualified", "Proposal", "Negotiation", "Closed Won", "Closed Lost"];

/** Mirrors the API's default probability per stage. */
export const STAGE_PROBABILITY: Record<DealStage, number> = {
  New: 10,
  Qualified: 25,
  Proposal: 50,
  Negotiation: 75,
  "Closed Won": 100,
  "Closed Lost": 0,
};

interface FormState {
  title: string;
  company: string;
  contact: string;
  value: string;
  probability: string;
  stage: DealStage;
  expectedClose: string;
  ownerId: string | null;
  lostReason: string;
}

const fromDeal = (deal: Deal | null | undefined, lead?: LinkedLead | null, ownerId?: string | null): FormState => ({
  title: deal?.title ?? (lead ? `${lead.company || lead.name} deal` : ""),
  company: deal?.company ?? lead?.company ?? "",
  contact: deal?.contact ?? lead?.name ?? "",
  value: deal ? String(deal.value) : "",
  probability: deal ? String(deal.probability) : "",
  stage: deal?.stage ?? "New",
  expectedClose: deal?.expectedClose ?? "",
  ownerId: deal ? deal.ownerId ?? null : lead?.ownerId ?? ownerId ?? null,
  lostReason: deal?.lostReason ?? "",
});

export interface LinkedLead {
  id: string;
  name: string;
  company: string;
  ownerId?: string | null;
}

export const DealFormModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  /** Edit this deal; omit to create. */
  deal?: Deal | null;
  /** New deal linked to this lead. */
  lead?: LinkedLead | null;
  defaultStage?: DealStage;
  onSaved?: (deal: Deal) => void;
}> = ({ isOpen, onClose, deal, lead, defaultStage, onSaved }) => {
  const me = useMe();
  const create = useCreateDeal();
  const update = useUpdateDeal();
  const [form, setForm] = useState<FormState>(() => fromDeal(deal, lead));
  const [localError, setLocalError] = useState<string | null>(null);
  const mutation = deal ? update : create;

  useEffect(() => {
    if (!isOpen) return;
    const initial = fromDeal(deal, lead, me.data?.user.id);
    if (!deal && defaultStage) initial.stage = defaultStage;
    setForm(initial);
    setLocalError(null);
    create.reset();
    update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, deal?.id, lead?.id]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const value = form.value.trim() === "" ? 0 : Number(form.value);
    const probability = form.probability.trim() === "" ? undefined : Number(form.probability);
    if (!form.title.trim()) return setLocalError("Deal title is required.");
    if (!Number.isFinite(value) || value < 0) return setLocalError("Value must be zero or more.");
    if (probability !== undefined && (!Number.isInteger(probability) || probability < 0 || probability > 100)) {
      return setLocalError("Probability must be a whole number from 0 to 100.");
    }
    setLocalError(null);

    const input: DealInput = {
      title: form.title.trim(),
      company: form.company.trim() || null,
      contact: form.contact.trim() || null,
      value,
      stage: form.stage,
      expectedClose: form.expectedClose || null,
      ownerId: form.ownerId,
      lostReason: form.stage === "Closed Lost" ? form.lostReason.trim() || null : undefined,
    };
    // An untouched probability on a stage change lets the server apply the new stage's default.
    const untouchedOnStageChange = deal && form.stage !== deal.stage && probability === deal.probability;
    if (probability !== undefined && !untouchedOnStageChange) input.probability = probability;
    if (!deal && lead) input.leadId = lead.id;

    try {
      const saved = deal ? await update.mutateAsync({ id: deal.id, patch: input }) : await create.mutateAsync(input);
      onSaved?.(saved);
      onClose();
    } catch {
      // Field errors render below; the toast came from useApiMutation.
    }
  };

  const err = mutation.error;
  const probabilityHint = `Leave blank for the stage default (${STAGE_PROBABILITY[form.stage]}%).`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => !mutation.isPending && onClose()}
      title={deal ? "Edit deal" : lead ? `New deal for ${lead.name}` : "Add deal"}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void submit()} isLoading={mutation.isPending}>
            {deal ? "Save deal" : "Create deal"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field id="deal-title" label="Deal title" error={fieldError(err, "title")}>
          <Input id="deal-title" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Annual subscription" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="deal-company" label="Company" error={fieldError(err, "company")}>
            <Input id="deal-company" value={form.company} onChange={(e) => set("company", e.target.value)} />
          </Field>
          <Field id="deal-contact" label="Contact" error={fieldError(err, "contact")}>
            <Input id="deal-contact" value={form.contact} onChange={(e) => set("contact", e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field id="deal-value" label="Value" error={fieldError(err, "value")}>
            <Input id="deal-value" type="number" min={0} step="any" value={form.value} onChange={(e) => set("value", e.target.value)} />
          </Field>
          <Field id="deal-probability" label="Probability (%)" hint={probabilityHint} error={fieldError(err, "probability")}>
            <Input
              id="deal-probability"
              type="number"
              min={0}
              max={100}
              value={form.probability}
              placeholder={String(STAGE_PROBABILITY[form.stage])}
              onChange={(e) => set("probability", e.target.value)}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field id="deal-stage" label="Stage" error={fieldError(err, "stage")}>
            <select id="deal-stage" value={form.stage} onChange={(e) => set("stage", e.target.value as DealStage)} className={selectClassName}>
              {DEAL_STAGES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field id="deal-close" label="Expected close" error={fieldError(err, "expectedClose")}>
            <Input id="deal-close" type="date" value={form.expectedClose} onChange={(e) => set("expectedClose", e.target.value)} />
          </Field>
        </div>
        <Field id="deal-owner" label="Owner" error={fieldError(err, "ownerId")}>
          <OwnerSelect id="deal-owner" value={form.ownerId} onChange={(v) => set("ownerId", v)} />
        </Field>
        {form.stage === "Closed Lost" && (
          <Field id="deal-lost" label="Lost reason" error={fieldError(err, "lostReason")}>
            <Input id="deal-lost" value={form.lostReason} onChange={(e) => set("lostReason", e.target.value)} placeholder="e.g. Chose a competitor" />
          </Field>
        )}
        {localError && <p className="text-xs text-destructive">{localError}</p>}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
};
