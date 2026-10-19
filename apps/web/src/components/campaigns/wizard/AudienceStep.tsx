"use client";

import React from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/settings/shared";
import { chip, type AudienceDraft } from "./draft";

const LEAD_STATUSES = ["New", "Contacted", "Qualified", "Hot", "Warm", "Cold", "Closed"];

export function AudienceStep({
  audience,
  setAudience,
  lockedSetup,
}: {
  audience: AudienceDraft;
  setAudience: React.Dispatch<React.SetStateAction<AudienceDraft>>;
  lockedSetup: boolean;
}) {
  const set = <K extends keyof AudienceDraft>(key: K, value: AudienceDraft[K]) => setAudience((a) => ({ ...a, [key]: value }));
  return (
    <Card className="space-y-5">
      {lockedSetup && (
        <p className="text-xs text-amber-500">
          The audience filter is locked after launch. Add more leads from the Leads page or the campaign detail page.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={lockedSetup} className={chip(audience.type === "filter")} onClick={() => set("type", "filter")}>
          Leads matching filters
        </button>
        <button type="button" disabled={lockedSetup} className={chip(audience.type === "manual")} onClick={() => set("type", "manual")}>
          Only leads I add manually
        </button>
      </div>
      {audience.type === "manual" ? (
        <p className="text-sm text-muted-foreground">
          Save the campaign, then add leads from the Leads page (&ldquo;Add to campaign&rdquo;). They are checked for consent and
          unsubscribes at launch.
        </p>
      ) : (
        <fieldset disabled={lockedSetup} className="space-y-4">
          <p className="text-xs text-muted-foreground">No filters means every lead in the workspace. Leads added manually are always included.</p>
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Lead status</span>
            <div className="flex flex-wrap gap-1.5">
              {LEAD_STATUSES.map((s) => {
                const active = audience.statuses.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    className={chip(active)}
                    onClick={() => setAudience((a) => ({ ...a, statuses: active ? a.statuses.filter((x) => x !== s) : [...a.statuses, s] }))}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field id="aud-min" label="Minimum score">
              <Input id="aud-min" type="number" min={0} max={100} value={audience.minScore} onChange={(e) => set("minScore", e.target.value)} placeholder="0" />
            </Field>
            <Field id="aud-max" label="Maximum score">
              <Input id="aud-max" type="number" min={0} max={100} value={audience.maxScore} onChange={(e) => set("maxScore", e.target.value)} placeholder="100" />
            </Field>
            <Field id="aud-sources" label="Sources" hint="Comma separated, e.g. Meta Lead Ads, AI Agent">
              <Input id="aud-sources" value={audience.sources} onChange={(e) => set("sources", e.target.value)} />
            </Field>
            <Field id="aud-tags" label="Tags (any of)" hint="Comma separated">
              <Input id="aud-tags" value={audience.tags} onChange={(e) => set("tags", e.target.value)} />
            </Field>
            <Field id="aud-course" label="Course interest contains">
              <Input id="aud-course" value={audience.courseInterest} onChange={(e) => set("courseInterest", e.target.value)} placeholder="e.g. NEET" />
            </Field>
            <Field id="aud-location" label="Location contains">
              <Input id="aud-location" value={audience.location} onChange={(e) => set("location", e.target.value)} placeholder="e.g. Kota" />
            </Field>
            <Field id="aud-after" label="Created on or after">
              <Input id="aud-after" type="date" value={audience.createdAfter} onChange={(e) => set("createdAfter", e.target.value)} />
            </Field>
          </div>
        </fieldset>
      )}
    </Card>
  );
}
