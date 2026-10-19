"use client";

import React from "react";
import { Mail, MessageCircle } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Field, fieldError } from "@/components/settings/shared";
import { cn } from "@/lib/utils";
import type { CampaignChannel } from "@/types";
import { textareaClass } from "./draft";

const CHANNEL_OPTIONS = [
  { value: "email", icon: Mail, title: "Email", text: "Sent through Resend with open/click tracking and an unsubscribe link." },
  { value: "whatsapp", icon: MessageCircle, title: "WhatsApp", text: "Approved WhatsApp Cloud API templates; replies stop the sequence." },
] as const;

export function SetupStep({
  name,
  onNameChange,
  description,
  onDescriptionChange,
  channel,
  onChannelChange,
  lockedSetup,
  saveError,
}: {
  name: string;
  onNameChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  channel: CampaignChannel;
  onChannelChange: (value: CampaignChannel) => void;
  lockedSetup: boolean;
  saveError: unknown;
}) {
  return (
    <Card className="space-y-5 max-w-2xl">
      <Field id="cmp-name" label="Campaign name" error={fieldError(saveError, "name")}>
        <Input id="cmp-name" value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="e.g. NEET 2027 batch — follow-up" maxLength={150} />
      </Field>
      <Field id="cmp-desc" label="Description (optional)">
        <textarea id="cmp-desc" className={textareaClass} rows={2} value={description} onChange={(e) => onDescriptionChange(e.target.value)} maxLength={2000} />
      </Field>
      <div className="space-y-2">
        <span className="text-xs font-medium text-muted-foreground">Channel</span>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {CHANNEL_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={lockedSetup}
              onClick={() => onChannelChange(opt.value)}
              className={cn(
                "rounded-xl border p-4 text-left transition-colors disabled:opacity-60 disabled:cursor-not-allowed",
                channel === opt.value ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted/50"
              )}
              aria-pressed={channel === opt.value}
            >
              <div className="flex items-center gap-2 font-medium text-foreground">
                <opt.icon className="h-4 w-4" /> {opt.title}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{opt.text}</p>
            </button>
          ))}
        </div>
        {lockedSetup && <p className="text-[11px] text-muted-foreground">The channel can only change while the campaign is a draft.</p>}
      </div>
    </Card>
  );
}
