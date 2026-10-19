import type { Request, RequestHandler } from "express";
import { HttpError } from "./errors";

interface RateLimitOptions {
  /** Distinguishes limiters that share a key (e.g. "agent-run"). */
  name: string;
  windowMs: number;
  max: number;
  /** Defaults to the org id (or the client IP before auth). */
  key?: (req: Request) => string;
}

/** In-process fixed-window limiter; good enough for a single API instance. */
export function rateLimit(options: RateLimitOptions): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req, res, next) => {
    const now = Date.now();
    const key = `${options.name}:${options.key ? options.key(req) : req.ctx?.orgId || req.ip}`;
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + options.windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }
    if (entry.count > options.max) {
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
      return next(new HttpError(429, "RATE_LIMITED", "Too many requests. Please wait a moment and try again."));
    }
    next();
  };
}
