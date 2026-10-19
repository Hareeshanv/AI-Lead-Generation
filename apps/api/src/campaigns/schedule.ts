import { z } from "zod";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Stored in campaigns.send_window. Days use JS numbering (0 = Sunday ... 6 = Saturday).
 * An empty object means "any time". end <= start is an overnight window (e.g. 20:00-06:00).
 */
export const sendWindowSchema = z
  .object({
    start: z.string().regex(TIME_RE, "Use HH:MM (24h)").optional(),
    end: z.string().regex(TIME_RE, "Use HH:MM (24h)").optional(),
    days: z.array(z.number().int().min(0).max(6)).min(1, "Pick at least one day").max(7).optional(),
    timezone: z.string().trim().refine(isValidTimeZone, "Unsupported time zone").optional(),
  })
  .strict()
  .refine((w) => (w.start == null) === (w.end == null), { message: "Set both start and end times", path: ["end"] })
  .refine((w) => w.start == null || w.start !== w.end, { message: "Start and end must differ", path: ["end"] });

export type SendWindow = z.output<typeof sendWindowSchema>;

export function readSendWindow(raw: unknown): SendWindow {
  const parsed = sendWindowSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

export function hasSendWindow(w: SendWindow): boolean {
  return w.start != null || (w.days != null && new Set(w.days).size < 7);
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
    });
    formatters.set(tz, f);
  }
  return f;
}

export function localParts(at: Date, tz: string): LocalParts {
  const parts: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(at)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday] ?? 0,
  };
}

function offsetMs(at: number, tz: string): number {
  const p = localParts(new Date(at), tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(at / 60_000) * 60_000;
}

/** The instant when the wall clock in `tz` shows the given local date and time. */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = offsetMs(guess, tz);
  let result = guess - first;
  const second = offsetMs(result, tz);
  if (second !== first) result = guess - second;
  return new Date(result);
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function isWithinSendWindow(at: Date, w: SendWindow, defaultTimeZone = "UTC"): boolean {
  if (!hasSendWindow(w)) return true;
  const p = localParts(at, w.timezone || defaultTimeZone);
  if (w.days && !w.days.includes(p.weekday)) return false;
  if (w.start == null || w.end == null) return true;
  const now = p.hour * 60 + p.minute;
  const start = minutesOf(w.start);
  const end = minutesOf(w.end);
  return start < end ? now >= start && now < end : now >= start || now < end;
}

/** `at` when it is inside the window, otherwise the next moment the window opens. */
export function nextSendWindowStart(at: Date, w: SendWindow, defaultTimeZone = "UTC"): Date {
  if (isWithinSendWindow(at, w, defaultTimeZone)) return at;
  const tz = w.timezone || defaultTimeZone;
  const today = localParts(at, tz);
  const [h, m] = w.start ? w.start.split(":").map(Number) : [0, 0];
  for (let offset = 0; offset <= 8; offset++) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    const candidate = zonedTimeToUtc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), h, m, tz);
    if (candidate.getTime() > at.getTime() && isWithinSendWindow(candidate, w, defaultTimeZone)) return candidate;
  }
  return new Date(at.getTime() + DAY_MS);
}

export function spacingMs(throttlePerHour: number): number {
  return Math.ceil(HOUR_MS / Math.max(1, throttlePerHour));
}

/**
 * Send times for `count` recipients starting at `startAt`: evenly spaced at the hourly throttle
 * and moved forward whenever a slot falls outside the send window.
 */
export function planSendTimes(
  count: number,
  startAt: Date,
  throttlePerHour: number,
  w: SendWindow = {},
  defaultTimeZone = "UTC"
): Date[] {
  const spacing = spacingMs(throttlePerHour);
  const out: Date[] = [];
  let cursor = startAt;
  for (let i = 0; i < count; i++) {
    cursor = nextSendWindowStart(cursor, w, defaultTimeZone);
    out.push(cursor);
    cursor = new Date(cursor.getTime() + spacing);
  }
  return out;
}

/**
 * How long a send must wait so the campaign stays under `throttlePerHour` messages in any rolling
 * hour. 0 when it may go now.
 */
export function throttleDelayMs(input: {
  sentLastHour: number;
  oldestSentAt: string | Date | null;
  throttlePerHour: number;
  now?: Date;
}): number {
  if (input.sentLastHour < Math.max(1, input.throttlePerHour)) return 0;
  const now = (input.now ?? new Date()).getTime();
  const oldest = input.oldestSentAt ? new Date(input.oldestSentAt).getTime() : now;
  return Math.max(1_000, oldest + HOUR_MS - now + 1_000);
}
