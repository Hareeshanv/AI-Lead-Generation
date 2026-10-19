import { toast } from "sonner";

/** User-facing message for any thrown value (ApiError messages are already user-safe). */
export function errorMessage(err: unknown, fallback = "Something went wrong. Try again."): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return fallback;
}

/** 422 NOT_CONFIGURED: a provider (email, WhatsApp, Slack, Serper, Sarvam, Meta, ...) needs credentials first. */
export function isNotConfiguredError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "NOT_CONFIGURED";
}

export function notifySuccess(message: string, description?: string): void {
  toast.success(message, description ? { description } : undefined);
}

export function notifyError(err: unknown, fallback?: string): void {
  const message = errorMessage(err, fallback);
  if (isNotConfiguredError(err) && typeof window !== "undefined" && !window.location.pathname.startsWith("/integrations")) {
    toast.error(message, { action: { label: "Open Integrations", onClick: () => window.location.assign("/integrations") } });
    return;
  }
  toast.error(message);
}
