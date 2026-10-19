"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Building2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { QueryState } from "@/components/ui/QueryState";
import { useHasRole } from "@/hooks/useMe";
import { useUpdateWorkspaceSettings, useWorkspaceSettings } from "@/hooks/useSettings";
import { formatCurrency } from "@/lib/utils";
import type { WorkspaceSettings as WorkspaceSettingsData } from "@/types";
import { Field, SectionTitle, fieldError, selectClassName } from "./shared";
import { DiscoverySettingsCard } from "./DiscoverySettingsCard";

const COMMON_CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD"];
const FALLBACK_TIMEZONES = ["Asia/Kolkata", "UTC", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York"];

function supportedTimezones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(key: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    return FALLBACK_TIMEZONES;
  }
}

export function WorkspaceSettings() {
  const query = useWorkspaceSettings();
  return (
    <QueryState query={query}>
      {(data) => (
        <div className="space-y-6">
          <WorkspaceForm data={data} />
          <DiscoverySettingsCard discovery={data.settings.discovery} />
        </div>
      )}
    </QueryState>
  );
}

function WorkspaceForm({ data }: { data: WorkspaceSettingsData }) {
  const isAdmin = useHasRole("admin");
  const update = useUpdateWorkspaceSettings();
  const timezones = useMemo(supportedTimezones, []);

  const [name, setName] = useState(data.organization.name);
  const [currency, setCurrency] = useState(data.settings.currency);
  const [timezone, setTimezone] = useState(data.settings.timezone);
  const [hot, setHot] = useState(String(data.settings.scoring.hot));
  const [warm, setWarm] = useState(String(data.settings.scoring.warm));

  useEffect(() => {
    setName(data.organization.name);
    setCurrency(data.settings.currency);
    setTimezone(data.settings.timezone);
    setHot(String(data.settings.scoring.hot));
    setWarm(String(data.settings.scoring.warm));
  }, [data]);

  const hotNum = Number(hot);
  const warmNum = Number(warm);
  const scoringError =
    !Number.isInteger(hotNum) || !Number.isInteger(warmNum) || hotNum < 1 || hotNum > 100 || warmNum < 0 || warmNum > 99
      ? "Thresholds must be whole numbers between 0 and 100."
      : hotNum <= warmNum
        ? "The hot threshold must be above the warm threshold."
        : undefined;

  const currencies = COMMON_CURRENCIES.includes(currency) ? COMMON_CURRENCIES : [currency, ...COMMON_CURRENCIES];
  const isDirty =
    name.trim() !== data.organization.name ||
    currency !== data.settings.currency ||
    timezone !== data.settings.timezone ||
    hotNum !== data.settings.scoring.hot ||
    warmNum !== data.settings.scoring.warm;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (scoringError) return;
    update.mutate({ name: name.trim(), currency, timezone, scoring: { hot: hotNum, warm: warmNum } });
  };

  return (
    <Card className="max-w-xl space-y-4">
      <SectionTitle
        icon={Building2}
        title="Workspace"
        description={isAdmin ? "Settings shared by everyone in this workspace." : "Only admins can change workspace settings."}
      />
      <form onSubmit={handleSubmit} className="space-y-4">
        <fieldset disabled={!isAdmin} className="space-y-4">
          <Field id="ws-name" label="Workspace name" error={fieldError(update.error, "name")}>
            <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="ws-currency" label="Currency" hint={`Example: ${formatCurrency(125000, currency)}`} error={fieldError(update.error, "currency")}>
              <select id="ws-currency" className={selectClassName} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="ws-timezone" label="Time zone" error={fieldError(update.error, "timezone")}>
              <select id="ws-timezone" className={selectClassName} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {(timezones.includes(timezone) ? timezones : [timezone, ...timezones]).map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Lead scoring thresholds</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="ws-hot" label="Hot at or above">
                <Input id="ws-hot" type="number" min={1} max={100} value={hot} onChange={(e) => setHot(e.target.value)} required />
              </Field>
              <Field id="ws-warm" label="Warm at or above">
                <Input id="ws-warm" type="number" min={0} max={99} value={warm} onChange={(e) => setWarm(e.target.value)} required />
              </Field>
            </div>
            <p className={scoringError ? "text-[11px] text-destructive" : "text-[11px] text-muted-foreground"}>
              {scoringError ?? fieldError(update.error, "scoring.hot") ?? `Scores below ${warmNum || 0} are cold.`}
            </p>
          </div>
        </fieldset>
        {isAdmin && (
          <div className="flex justify-end">
            <Button variant="primary" size="sm" type="submit" disabled={!isDirty || Boolean(scoringError) || !name.trim()} isLoading={update.isPending}>
              Save workspace
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}
