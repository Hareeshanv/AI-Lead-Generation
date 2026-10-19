import type { Lead } from "@/types";
import { leadSourceLabel } from "@/lib/analytics";

type Cell = string | number | boolean | null | undefined;

const escapeCell = (value: Cell): string => {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const toCsv = (header: string[], rows: Cell[][]): string =>
  [header, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n");

export const downloadCsv = (filename: string, csv: string): void => {
  // Leading BOM so Excel opens UTF-8 names correctly.
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const contactValue = (value?: string | null): string => (value && value !== "Not available" ? value : "");

export const leadsToCsv = (leads: Lead[]): string =>
  toCsv(
    [
      "Name",
      "Title",
      "Company",
      "Industry",
      "Email",
      "Phone",
      "Location",
      "Score",
      "Status",
      "Source",
      "Campaign",
      "Course interest",
      "Exam year",
      "Created at",
    ],
    leads.map((l) => [
      l.name,
      l.title,
      l.company,
      l.industry,
      contactValue(l.email),
      contactValue(l.phone),
      l.location,
      l.score,
      l.status,
      leadSourceLabel(l),
      l.campaignName,
      l.courseInterest,
      l.examYear,
      l.createdAt,
    ])
  );

export const csvFilename = (prefix: string): string => `${prefix}-${new Date().toISOString().slice(0, 10)}.csv`;
