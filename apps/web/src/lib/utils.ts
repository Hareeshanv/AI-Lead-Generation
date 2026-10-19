import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { LeadSourcePlatform } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Workspace number formatting; updated from /api/me by `useMe`. */
const orgFormat = { currency: "INR", locale: "en-IN" };

export function setOrgFormat(format: { currency?: string; locale?: string }): void {
  if (format.currency) orgFormat.currency = format.currency;
  if (format.locale) orgFormat.locale = format.locale;
}

export function formatCurrency(amount: number, currency: string = orgFormat.currency): string {
  try {
    return new Intl.NumberFormat(orgFormat.locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
  }
}

export const sourcePlatformLabel = (platform?: LeadSourcePlatform | null): string => {
  if (platform === "meta") return "Meta (IG/FB)";
  if (platform === "google") return "Google Ads";
  return "Other";
};

/** Medium date and short time in the browser locale; `fallback` for a missing or invalid date. */
export function formatDateTime(iso?: string | null, fallback = "—"): string {
  if (!iso) return fallback;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export const formatConsentTime = (iso?: string | null): string | null => formatDateTime(iso, "") || null;
