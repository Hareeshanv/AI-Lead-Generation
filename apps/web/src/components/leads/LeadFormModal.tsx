"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Field, fieldError, selectClassName } from "@/components/settings/shared";
import { OwnerSelect } from "@/components/crm/shared";
import { useCreateLead, useUpdateLead } from "@/hooks/useLeads";
import { useMe } from "@/hooks/useMe";
import { LEAD_STATUSES } from "@/lib/analytics";
import type { ConsentChannel, Lead, LeadInput, LeadStatus } from "@/types";

const CONSENT_OPTIONS: { value: ConsentChannel; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "sms", label: "SMS" },
  { value: "call", label: "Phone call" },
];

const contact = (v?: string | null) => (v && v !== "Not available" ? v : "");

interface FormState {
  name: string;
  email: string;
  phone: string;
  company: string;
  title: string;
  location: string;
  industry: string;
  source: string;
  /** "" = let the scorer decide (create only). */
  status: LeadStatus | "";
  ownerId: string | null;
  tags: string;
  consentChannel: ConsentChannel[];
  doNotContact: boolean;
}

const fromLead = (lead: Lead | null | undefined, myId: string | null): FormState => ({
  name: lead?.name ?? "",
  email: contact(lead?.email),
  phone: contact(lead?.phone),
  company: lead?.company ?? "",
  title: lead?.title ?? "",
  location: lead?.location ?? "",
  industry: lead?.industry ?? "",
  source: lead?.source ?? "Manual Entry",
  status: lead?.status ?? "",
  ownerId: lead ? lead.ownerId ?? null : myId,
  tags: (lead?.tags ?? []).join(", "),
  consentChannel: lead?.consentChannel ?? [],
  doNotContact: lead?.doNotContact ?? false,
});

export const LeadFormModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  /** Edit this lead; omit to create. */
  lead?: Lead | null;
  onSaved?: (lead: Lead) => void;
}> = ({ isOpen, onClose, lead, onSaved }) => {
  const me = useMe();
  const create = useCreateLead();
  const update = useUpdateLead();
  const mutation = lead ? update : create;
  const [form, setForm] = useState<FormState>(() => fromLead(lead, null));
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setForm(fromLead(lead, me.data?.user.id ?? null));
    setLocalError(null);
    create.reset();
    update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, lead?.id]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!form.name.trim()) return setLocalError("Name is required.");
    setLocalError(null);
    const input: LeadInput = {
      name: form.name.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      company: form.company.trim() || null,
      title: form.title.trim() || null,
      location: form.location.trim() || null,
      industry: form.industry.trim() || null,
      source: form.source.trim() || "Manual Entry",
      ownerId: form.ownerId,
      tags: Array.from(new Set(form.tags.split(",").map((t) => t.trim()).filter(Boolean))),
      consentChannel: form.consentChannel,
      doNotContact: form.doNotContact,
    };
    if (form.status && (!lead || form.status !== lead.status)) input.status = form.status;
    try {
      const saved = lead ? await update.mutateAsync({ id: lead.id, patch: input }) : await create.mutateAsync(input);
      onSaved?.(saved);
      onClose();
    } catch {
      // Field errors render inline; useApiMutation showed a toast.
    }
  };

  const err = mutation.error;
  const text = (key: "name" | "email" | "phone" | "company" | "title" | "location" | "industry" | "source", label: string, extra?: Partial<React.InputHTMLAttributes<HTMLInputElement>>) => (
    <Field id={`lead-${key}`} label={label} error={fieldError(err, key)}>
      <Input id={`lead-${key}`} value={form[key]} onChange={(e) => set(key, e.target.value)} {...extra} />
    </Field>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => !mutation.isPending && onClose()}
      title={lead ? "Edit lead" : "Add lead"}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void submit()} isLoading={mutation.isPending}>
            {lead ? "Save lead" : "Create lead"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {text("name", "Name", { placeholder: "Full name", autoFocus: true, maxLength: 200 })}
        <div className="grid grid-cols-2 gap-3">
          {text("email", "Email", { type: "email", placeholder: "name@company.com" })}
          {text("phone", "Phone", { type: "tel", placeholder: "+91 98765 43210" })}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {text("company", "Company")}
          {text("title", "Job title")}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {text("location", "Location")}
          {text("industry", "Industry / interest")}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {text("source", "Source")}
          <Field
            id="lead-status"
            label="Status"
            hint={lead ? undefined : "Leave on Auto to set Hot / Warm / Cold from the score."}
            error={fieldError(err, "status")}
          >
            <select id="lead-status" value={form.status} onChange={(e) => set("status", e.target.value as LeadStatus | "")} className={selectClassName}>
              {!lead && <option value="">Auto (from score)</option>}
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field id="lead-owner" label="Owner" error={fieldError(err, "ownerId")}>
            <OwnerSelect id="lead-owner" value={form.ownerId} onChange={(v) => set("ownerId", v)} />
          </Field>
          <Field id="lead-tags" label="Tags" hint="Comma separated" error={fieldError(err, "tags")}>
            <Input id="lead-tags" value={form.tags} onChange={(e) => set("tags", e.target.value)} placeholder="vip, webinar" />
          </Field>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-muted-foreground">Consented channels</legend>
          <div className="flex flex-wrap gap-3">
            {CONSENT_OPTIONS.map((opt) => (
              <label key={opt.value} className="inline-flex items-center gap-1.5 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={form.consentChannel.includes(opt.value)}
                  onChange={(e) =>
                    set(
                      "consentChannel",
                      e.target.checked ? [...form.consentChannel, opt.value] : form.consentChannel.filter((c) => c !== opt.value)
                    )
                  }
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                {opt.label}
              </label>
            ))}
          </div>
          <label className="inline-flex items-center gap-1.5 text-sm text-foreground">
            <input
              type="checkbox"
              checked={form.doNotContact}
              onChange={(e) => set("doNotContact", e.target.checked)}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            Do not contact (excluded from campaigns)
          </label>
        </fieldset>
        {localError && <p className="text-xs text-destructive">{localError}</p>}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
};
