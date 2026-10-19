export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** A logger that adds `bindings` to every line (e.g. { module: "jobs" }). */
  child(bindings: LogFields): Logger;
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function configuredLevel(): number {
  const raw = String(process.env.LOG_LEVEL || "").toLowerCase();
  if (raw in LEVELS) return LEVELS[raw as LogLevel];
  return process.env.NODE_ENV === "test" ? LEVELS.warn : LEVELS.info;
}

/** Errors become { name, message, stack, code? } so they survive JSON.stringify. */
export function serializeError(err: unknown): unknown {
  if (err instanceof Error) {
    const out: Record<string, unknown> = { name: err.name, message: err.message, stack: err.stack };
    const code = (err as { code?: unknown }).code;
    if (code !== undefined) out.code = code;
    return out;
  }
  return err;
}

function normalize(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    out[key] = value instanceof Error ? serializeError(value) : value;
  }
  return out;
}

function safeStringify(record: LogFields): string {
  try {
    return JSON.stringify(record);
  } catch {
    const seen = new WeakSet<object>();
    return JSON.stringify(record, (_key, value) => {
      if (typeof value === "bigint") return value.toString();
      if (value && typeof value === "object") {
        if (seen.has(value)) return "[Circular]";
        seen.add(value);
      }
      return value;
    });
  }
}

function write(level: LogLevel, bindings: LogFields, msg: string, fields?: LogFields): void {
  if (LEVELS[level] < configuredLevel()) return;
  const record = { time: new Date().toISOString(), level, msg, ...bindings, ...(fields ? normalize(fields) : {}) };
  const line = safeStringify(record) + "\n";
  if (LEVELS[level] >= LEVELS.warn) process.stderr.write(line);
  else process.stdout.write(line);
}

function createLogger(bindings: LogFields): Logger {
  return {
    debug: (msg, fields) => write("debug", bindings, msg, fields),
    info: (msg, fields) => write("info", bindings, msg, fields),
    warn: (msg, fields) => write("warn", bindings, msg, fields),
    error: (msg, fields) => write("error", bindings, msg, fields),
    child: (extra) => createLogger({ ...bindings, ...normalize(extra) }),
  };
}

/** One JSON object per line: { time, level, msg, ...bindings, ...fields }. LOG_LEVEL sets the minimum level. */
export const logger: Logger = createLogger({ service: "api" });
