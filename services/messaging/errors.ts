/** A failed provider call. `retryable` is true for network errors, rate limits and 5xx responses. */
export class MessagingError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly providerCode?: string | number
  ) {
    super(message);
    this.name = "MessagingError";
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    const reason = err?.name === "AbortError" ? `timed out after ${timeoutMs}ms` : err?.message || String(err);
    throw new MessagingError(`Request to ${new URL(url).host} failed: ${reason}`, true);
  } finally {
    clearTimeout(timer);
  }
}
