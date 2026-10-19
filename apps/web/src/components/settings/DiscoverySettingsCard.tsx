"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Radar } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useHasRole } from "@/hooks/useMe";
import { useUpdateWorkspaceSettings } from "@/hooks/useSettings";
import type { DiscoverySettings, DiscoveryTerm, InterestPreset } from "@/types";
import { Field, SectionTitle, fieldError, selectClassName } from "./shared";

// Mirrors the API limits in services/search/vocabulary.ts.
const MAX_TERMS = 100;
const MAX_ALIASES = 20;
const MAX_TERM_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 300;

const PRESETS: { value: InterestPreset; label: string }[] = [
  { value: "none", label: "None (only the interests below)" },
  { value: "education", label: "Education: courses and exams (NEET, JEE, Python, …)" },
];

const textareaClassName =
  "w-full rounded-lg bg-card/60 border border-border px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all disabled:opacity-60";

/** One term per line: `Label: alias, alias`. */
function termsToText(terms: DiscoveryTerm[]): string {
  return terms.map((t) => (t.aliases.length > 0 ? `${t.label}: ${t.aliases.join(", ")}` : t.label)).join("\n");
}

function textToTerms(text: string): DiscoveryTerm[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const colon = line.indexOf(":");
      if (colon < 0) return { label: line, aliases: [] };
      return {
        label: line.slice(0, colon).trim(),
        aliases: line
          .slice(colon + 1)
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean),
      };
    })
    .filter((t) => t.label);
}

function termsProblem(terms: DiscoveryTerm[]): string | undefined {
  if (terms.length > MAX_TERMS) return `At most ${MAX_TERMS} entries.`;
  const long = terms.find((t) => t.label.length > MAX_TERM_LENGTH || t.aliases.some((a) => a.length > MAX_TERM_LENGTH));
  if (long) return `"${long.label.slice(0, 30)}…" is too long (max ${MAX_TERM_LENGTH} characters per name).`;
  const crowded = terms.find((t) => t.aliases.length > MAX_ALIASES);
  if (crowded) return `"${crowded.label}" has more than ${MAX_ALIASES} spellings.`;
  return undefined;
}

function displayName(type: "region" | "language", code: string): string | undefined {
  try {
    const name = new Intl.DisplayNames(["en"], { type }).of(type === "region" ? code.toUpperCase() : code);
    return name && name.toLowerCase() !== code.toLowerCase() ? name : undefined;
  } catch {
    return undefined;
  }
}

/** Server field errors for a term list, e.g. "discovery.cities.3.label". */
function termsFieldError(err: unknown, key: "interests" | "cities"): string | undefined {
  const fields = (err as { fields?: Record<string, string[]> } | null)?.fields ?? {};
  const hit = Object.keys(fields).find((f) => f === `discovery.${key}` || f.startsWith(`discovery.${key}.`));
  return hit ? fields[hit][0] : undefined;
}

export function DiscoverySettingsCard({ discovery }: { discovery: DiscoverySettings }) {
  const isAdmin = useHasRole("admin");
  const update = useUpdateWorkspaceSettings();

  const [description, setDescription] = useState(discovery.businessDescription ?? "");
  const [country, setCountry] = useState(discovery.country);
  const [language, setLanguage] = useState(discovery.language);
  const [preset, setPreset] = useState<InterestPreset>(discovery.interestPreset);
  const [interestsText, setInterestsText] = useState(termsToText(discovery.interests));
  const [citiesText, setCitiesText] = useState(termsToText(discovery.cities));

  useEffect(() => {
    setDescription(discovery.businessDescription ?? "");
    setCountry(discovery.country);
    setLanguage(discovery.language);
    setPreset(discovery.interestPreset);
    setInterestsText(termsToText(discovery.interests));
    setCitiesText(termsToText(discovery.cities));
  }, [discovery]);

  const interests = useMemo(() => textToTerms(interestsText), [interestsText]);
  const cities = useMemo(() => textToTerms(citiesText), [citiesText]);

  const countryCode = country.trim().toLowerCase();
  const languageCode = language.trim();
  const countryError = /^[a-z]{2}$/.test(countryCode) ? undefined : "Use a two-letter country code, e.g. in or us.";
  const languageError = /^[a-zA-Z]{2,3}(?:-[a-zA-Z]{2,4})?$/.test(languageCode) ? undefined : "Use a language code such as en or hi.";
  const interestsError = termsProblem(interests);
  const citiesError = termsProblem(cities);
  const invalid = Boolean(countryError || languageError || interestsError || citiesError);

  const next: DiscoverySettings = {
    businessDescription: description.trim() || null,
    country: countryCode,
    language: languageCode,
    interestPreset: preset,
    interests,
    cities,
  };
  const isDirty = JSON.stringify(next) !== JSON.stringify({ ...discovery, businessDescription: discovery.businessDescription ?? null });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    update.mutate({ discovery: next });
  };

  return (
    <Card className="max-w-xl space-y-4">
      <SectionTitle
        icon={Radar}
        title="Lead discovery"
        description={
          isAdmin
            ? "What AI search and the discovery agent look for in this workspace."
            : "What AI search and the discovery agent look for. Only admins can change this."
        }
      />
      <form onSubmit={handleSubmit} className="space-y-4">
        <fieldset disabled={!isAdmin} className="space-y-4">
          <Field
            id="disc-description"
            label="What you sell"
            hint="One line, used in AI prompts. Example: Spoken English courses for working professionals."
            error={fieldError(update.error, "discovery.businessDescription")}
          >
            <Input
              id="disc-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={MAX_DESCRIPTION_LENGTH}
              placeholder="Leave empty for a generic prompt"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="disc-country"
              label="Country"
              hint={displayName("region", countryCode) ?? "Two-letter code. Sets search results and built-in cities."}
              error={fieldError(update.error, "discovery.country") ?? countryError}
            >
              <Input id="disc-country" value={country} onChange={(e) => setCountry(e.target.value)} maxLength={2} required />
            </Field>
            <Field
              id="disc-language"
              label="Language"
              hint={displayName("language", languageCode) ?? "Search interface language, e.g. en."}
              error={fieldError(update.error, "discovery.language") ?? languageError}
            >
              <Input id="disc-language" value={language} onChange={(e) => setLanguage(e.target.value)} maxLength={10} required />
            </Field>
          </div>
          <Field
            id="disc-preset"
            label="Built-in interests"
            hint="Added after your own interests below."
            error={fieldError(update.error, "discovery.interestPreset")}
          >
            <select id="disc-preset" className={selectClassName} value={preset} onChange={(e) => setPreset(e.target.value as InterestPreset)}>
              {PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            id="disc-interests"
            label={`Your interests (${interests.length}/${MAX_TERMS})`}
            hint="Products, services or courses, one per line. Add other spellings after a colon: Data Science: data scientist, ds"
            error={interestsError ?? termsFieldError(update.error, "interests")}
          >
            <textarea
              id="disc-interests"
              rows={5}
              className={textareaClassName}
              value={interestsText}
              onChange={(e) => setInterestsText(e.target.value)}
              spellCheck={false}
            />
          </Field>
          <Field
            id="disc-cities"
            label={`Your cities (${cities.length}/${MAX_TERMS})`}
            hint="Added before the country's built-in cities, one per line: Bengaluru: bangalore, blr"
            error={citiesError ?? termsFieldError(update.error, "cities")}
          >
            <textarea
              id="disc-cities"
              rows={4}
              className={textareaClassName}
              value={citiesText}
              onChange={(e) => setCitiesText(e.target.value)}
              spellCheck={false}
            />
          </Field>
        </fieldset>
        {isAdmin && (
          <div className="flex justify-end">
            <Button variant="primary" size="sm" type="submit" disabled={!isDirty || invalid} isLoading={update.isPending}>
              Save discovery settings
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}
