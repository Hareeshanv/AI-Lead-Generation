"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Globe, Hash, MapPin, Play, Search } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ApiError } from "@/services/api";
import { useStartAgentRun } from "@/hooks/useAgents";
import { cn } from "@/lib/utils";
import type { Agent, AgentRun, DiscoverySource } from "@/types";
import { SOURCE_LABELS } from "./shared";

const SOURCE_HELP: Record<DiscoverySource, string> = {
  web: "Public posts from people asking for this (Reddit, Quora, LinkedIn, …). Saved as intent signals.",
  places: "Google Maps businesses matching the query. Saved as leads.",
};

type FieldErrors = Partial<Record<"query" | "location" | "sources" | "maxResults", string>>;

function validate(query: string, location: string, sources: DiscoverySource[], maxResults: string, limit: number): FieldErrors {
  const errors: FieldErrors = {};
  const q = query.trim();
  const l = location.trim();
  if (q.length < 2) errors.query = "Enter at least 2 characters.";
  else if (q.length > 200) errors.query = "Keep it under 200 characters.";
  if (l.length < 2) errors.location = "Enter a city or area.";
  else if (l.length > 120) errors.location = "Keep it under 120 characters.";
  if (sources.length === 0) errors.sources = "Pick at least one source.";
  const n = Number(maxResults.trim());
  if (!maxResults.trim() || !Number.isInteger(n) || n < 1 || n > limit) errors.maxResults = `Enter a whole number from 1 to ${limit}.`;
  return errors;
}

export const RunForm: React.FC<{ agent: Agent; onStarted: (run: AgentRun) => void }> = ({ agent, onStarted }) => {
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [sources, setSources] = useState<DiscoverySource[]>(agent.sources.length ? agent.sources : ["web", "places"]);
  const [maxResults, setMaxResults] = useState(String(agent.defaultMaxResults));
  const [submitted, setSubmitted] = useState(false);
  const start = useStartAgentRun(agent.id, onStarted);

  const configured = agent.serperConfigured && agent.sarvamConfigured;
  const errors = validate(query, location, sources, maxResults, agent.maxResultsLimit);
  const serverFields = start.error instanceof ApiError ? start.error.fields ?? {} : {};
  const fieldError = (key: keyof FieldErrors) => (submitted ? errors[key] : undefined) ?? serverFields[key]?.[0];

  const toggleSource = (source: DiscoverySource) =>
    setSources((prev) => (prev.includes(source) ? prev.filter((s) => s !== source) : [...prev, source]));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length > 0 || !configured) return;
    start.mutate(
      { query: query.trim(), location: location.trim(), sources, maxResults: Number(maxResults) },
      { onSuccess: () => setSubmitted(false) }
    );
  };

  const missing = [!agent.serperConfigured && "Serper (search)", !agent.sarvamConfigured && "Sarvam (AI scoring)"].filter(Boolean);

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-base font-medium text-foreground">New discovery run</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Works for any niche: describe what you sell (or the kind of business you want as customers) and where.
        </p>
      </div>

      {!configured && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            {missing.join(" and ")} {missing.length > 1 ? "are" : "is"} not configured.{" "}
            <Link href="/integrations" className="font-medium underline">
              Add the API key{missing.length > 1 ? "s" : ""} under Integrations
            </Link>{" "}
            to run the agent.
          </span>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="agent-query" className="text-xs font-medium text-muted-foreground mb-1.5 block">
              What to search for
            </label>
            <Input
              id="agent-query"
              icon={<Search className="w-4 h-4" />}
              placeholder="e.g. dental clinic, Java course, interior designer"
              value={query}
              maxLength={200}
              onChange={(e) => setQuery(e.target.value)}
              aria-invalid={Boolean(fieldError("query"))}
              disabled={start.isPending}
            />
            {fieldError("query") && <p className="mt-1 text-xs text-destructive">{fieldError("query")}</p>}
          </div>
          <div>
            <label htmlFor="agent-location" className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Location
            </label>
            <Input
              id="agent-location"
              icon={<MapPin className="w-4 h-4" />}
              placeholder="e.g. Bengaluru, Pune, Andheri Mumbai"
              value={location}
              maxLength={120}
              onChange={(e) => setLocation(e.target.value)}
              aria-invalid={Boolean(fieldError("location"))}
              disabled={start.isPending}
            />
            {fieldError("location") && <p className="mt-1 text-xs text-destructive">{fieldError("location")}</p>}
          </div>
        </div>

        <fieldset>
          <legend className="text-xs font-medium text-muted-foreground mb-1.5">Sources</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(["web", "places"] as DiscoverySource[]).map((source) => {
              const on = sources.includes(source);
              return (
                <button
                  key={source}
                  type="button"
                  role="switch"
                  aria-checked={on}
                  onClick={() => toggleSource(source)}
                  disabled={start.isPending}
                  className={cn(
                    "text-left rounded-lg border p-3 transition-colors disabled:opacity-60",
                    on ? "border-primary/60 bg-primary/5" : "border-border hover:bg-muted/50"
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {source === "web" ? <Globe className="w-4 h-4" /> : <MapPin className="w-4 h-4" />}
                    {SOURCE_LABELS[source]}
                    <span
                      className={cn(
                        "ml-auto h-4 w-7 rounded-full p-0.5 transition-colors",
                        on ? "bg-primary" : "bg-muted-foreground/30"
                      )}
                    >
                      <span className={cn("block h-3 w-3 rounded-full bg-white transition-transform", on && "translate-x-3")} />
                    </span>
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">{SOURCE_HELP[source]}</span>
                </button>
              );
            })}
          </div>
          {fieldError("sources") && <p className="mt-1 text-xs text-destructive">{fieldError("sources")}</p>}
        </fieldset>

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-44">
            <label htmlFor="agent-max" className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Max results per source
            </label>
            <Input
              id="agent-max"
              icon={<Hash className="w-4 h-4" />}
              type="number"
              inputMode="numeric"
              min={1}
              max={agent.maxResultsLimit}
              step={1}
              value={maxResults}
              onChange={(e) => setMaxResults(e.target.value)}
              aria-invalid={Boolean(fieldError("maxResults"))}
              disabled={start.isPending}
            />
          </div>
          <Button type="submit" variant="primary" disabled={!configured} isLoading={start.isPending}>
            {!start.isPending && <Play className="w-3.5 h-3.5" />}
            {start.isPending ? "Starting…" : "Run agent"}
          </Button>
        </div>
        {fieldError("maxResults") && <p className="text-xs text-destructive">{fieldError("maxResults")}</p>}
        <p className="text-xs text-muted-foreground">
          Runs take 30 seconds to a few minutes and continue in the background; you can leave this page. Duplicates of your existing
          leads (same website, phone or email) are skipped.
        </p>
      </form>
    </Card>
  );
};
