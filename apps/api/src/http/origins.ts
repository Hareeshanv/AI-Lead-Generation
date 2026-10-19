/** WEB_APP_URL may list several origins separated by commas. */
export function configuredOrigins(raw = process.env.WEB_APP_URL || "http://localhost:3000"): string[] {
  return raw
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

/**
 * Requests with no Origin are not CORS requests (curl, webhooks).
 * In local dev, Next falls back to 3001 when 3000 is taken; allow any loopback origin then.
 * Production stays limited to WEB_APP_URL.
 */
export function isAllowedOrigin(origin: string | undefined, configured = configuredOrigins()): boolean {
  if (!origin) return true;
  const normalized = origin.replace(/\/+$/, "");
  if (configured.includes(normalized)) return true;
  return process.env.NODE_ENV !== "production" && isLoopbackOrigin(normalized);
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
    return loopback && (url.protocol === "http:" || url.protocol === "https:");
  } catch {
    return false;
  }
}
