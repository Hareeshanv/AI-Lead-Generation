"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { smallSelectClassName } from "@/components/crm/shared";
import { useImportLeads } from "@/hooks/useLeads";
import { notifyError } from "@/lib/toast";
import { parseCsv } from "@/lib/csvParse";
import type { LeadImportField, LeadImportResult } from "@/types";

const MAX_ROWS = 2000;

const FIELDS: { value: LeadImportField; label: string; aliases: string[] }[] = [
  { value: "name", label: "Name", aliases: ["name", "full name", "fullname", "contact", "contact name", "lead name", "student name"] },
  { value: "email", label: "Email", aliases: ["email", "e-mail", "email address", "work email", "mail"] },
  { value: "phone", label: "Phone", aliases: ["phone", "phone number", "mobile", "mobile number", "contact number", "whatsapp", "tel"] },
  { value: "company", label: "Company", aliases: ["company", "company name", "organization", "organisation", "account", "school", "college"] },
  { value: "title", label: "Job title", aliases: ["title", "job title", "designation", "position", "role"] },
  { value: "location", label: "Location", aliases: ["location", "city", "address", "region", "state"] },
  { value: "industry", label: "Industry", aliases: ["industry", "sector", "vertical"] },
  { value: "source", label: "Source", aliases: ["source", "lead source", "channel"] },
  { value: "status", label: "Status", aliases: ["status", "lead status"] },
  { value: "score", label: "Score", aliases: ["score", "lead score"] },
  { value: "tags", label: "Tags", aliases: ["tags", "labels", "tag"] },
  { value: "courseInterest", label: "Course interest", aliases: ["course", "course interest", "interest", "program", "programme"] },
  { value: "examYear", label: "Exam year", aliases: ["exam year", "year", "batch"] },
  { value: "profileUrl", label: "Profile URL", aliases: ["profile", "profile url", "linkedin", "linkedin url", "url", "website"] },
];

const normalize = (s: string) => s.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");

function guessMapping(headers: string[]): (LeadImportField | "")[] {
  const used = new Set<LeadImportField>();
  return headers.map((h) => {
    const key = normalize(h);
    const match = FIELDS.find((f) => !used.has(f.value) && f.aliases.includes(key));
    if (match) used.add(match.value);
    return match?.value ?? "";
  });
}

export const ImportLeadsModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const importLeads = useImportLeads();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<(LeadImportField | "")[]>([]);
  const [tags, setTags] = useState("");
  const [result, setResult] = useState<LeadImportResult | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setFileName(null);
    setHeaders([]);
    setRows([]);
    setMapping([]);
    setTags("");
    setResult(null);
    importLeads.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => notifyError(`Could not read ${file.name}.`);
    reader.onload = () => {
      const parsed = parseCsv(String(reader.result ?? ""));
      if (parsed.length < 2) {
        notifyError(`${file.name} has no data rows. The first row must be column headers.`);
        return;
      }
      const [head, ...body] = parsed;
      if (body.length > MAX_ROWS) notifyError(`Only the first ${MAX_ROWS} rows will be imported. Split larger files.`);
      setFileName(file.name);
      setHeaders(head.map((h, i) => h.trim() || `Column ${i + 1}`));
      setRows(body.slice(0, MAX_ROWS));
      setMapping(guessMapping(head));
      setResult(null);
    };
    reader.readAsText(file);
  };

  const mapped = useMemo(
    () =>
      rows.map((row) => {
        const out: Record<string, string> = {};
        mapping.forEach((field, i) => {
          const value = (row[i] ?? "").trim();
          if (!field || !value) return;
          out[field] = field === "tags" && out.tags ? `${out.tags},${value}` : value;
        });
        return out;
      }),
    [rows, mapping]
  );

  const hasName = mapping.includes("name");
  const runImport = async () => {
    try {
      const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
      setResult(await importLeads.mutateAsync({ rows: mapped, tags: tagList }));
    } catch {
      // toast shown
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => !importLeads.isPending && onClose()}
      title="Import leads from CSV"
      footer={
        result ? (
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={onClose} disabled={importLeads.isPending}>
              Cancel
            </Button>
            <Button size="sm" onClick={runImport} isLoading={importLeads.isPending} disabled={rows.length === 0 || !hasName}>
              Import {rows.length > 0 ? `${rows.length} row${rows.length === 1 ? "" : "s"}` : ""}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3 text-sm">
          <p className="text-foreground">
            <strong>{result.imported}</strong> imported, <strong>{result.duplicates}</strong> duplicates skipped,{" "}
            <strong>{result.invalid}</strong> invalid.
          </p>
          {result.errors.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-muted/30 p-2 text-xs">
              {result.errors.map((e) => (
                <div key={e.row} className="py-0.5">
                  <span className="font-medium text-foreground">Row {e.row}:</span> <span className="text-muted-foreground">{e.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground hover:border-primary/50 hover:bg-muted/40"
          >
            {fileName ? <FileSpreadsheet className="h-6 w-6 text-primary" /> : <Upload className="h-6 w-6" />}
            {fileName ? (
              <span>
                <span className="font-medium text-foreground">{fileName}</span> · {rows.length} rows · choose another file
              </span>
            ) : (
              <span>Choose a CSV file (first row = column headers, up to {MAX_ROWS} rows)</span>
            )}
          </button>

          {headers.length > 0 && (
            <>
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Map columns to lead fields</p>
                <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                  {headers.map((h, i) => (
                    <div key={`${h}-${i}`} className="grid grid-cols-[1fr_auto] items-center gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-foreground">{h}</div>
                        <div className="truncate text-[11px] text-muted-foreground">{rows[0]?.[i] || "—"}</div>
                      </div>
                      <select
                        value={mapping[i] ?? ""}
                        onChange={(e) => setMapping((m) => m.map((v, j) => (j === i ? (e.target.value as LeadImportField | "") : v)))}
                        className={smallSelectClassName}
                        aria-label={`Field for ${h}`}
                      >
                        <option value="">Skip</option>
                        {FIELDS.map((f) => (
                          <option key={f.value} value={f.value} disabled={f.value !== "tags" && mapping.includes(f.value) && mapping[i] !== f.value}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <label htmlFor="import-tags" className="text-xs font-medium text-muted-foreground">
                  Tag every imported lead (optional)
                </label>
                <Input id="import-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. expo-2026" />
              </div>
              {!hasName && <p className="text-xs text-destructive">Map a column to Name to continue.</p>}
              <p className="text-[11px] text-muted-foreground">
                Leads with an email already in the workspace are skipped. Each lead is scored automatically.
              </p>
            </>
          )}
        </div>
      )}
    </Modal>
  );
};
