import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { DbError, UNIQUE_VIOLATION } from "@ai-lead-gen/database";
import { logger } from "../logger";

export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NO_ORGANIZATION"
  | "NOT_A_MEMBER"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "NOT_CONFIGURED"
  | "UPSTREAM_ERROR"
  | "INTERNAL";

/** Field path ("steps.0.subject") -> messages. */
export type FieldErrors = Record<string, string[]>;

/** Every error response: { success: false, error: { code, message, fields? } }. */
export interface ErrorBody {
  success: false;
  error: { code: ErrorCode; message: string; fields?: FieldErrors };
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly fields?: FieldErrors
  ) {
    super(message);
    this.name = "HttpError";
  }

  static badRequest(message: string, fields?: FieldErrors) {
    return new HttpError(400, "BAD_REQUEST", message, fields);
  }
  static unauthorized(message = "Sign in to continue.") {
    return new HttpError(401, "UNAUTHORIZED", message);
  }
  static forbidden(message = "You do not have permission to do this.") {
    return new HttpError(403, "FORBIDDEN", message);
  }
  static notFound(what = "Resource") {
    return new HttpError(404, "NOT_FOUND", `${what} not found.`);
  }
  static conflict(message: string) {
    return new HttpError(409, "CONFLICT", message);
  }
  static notConfigured(message: string) {
    return new HttpError(422, "NOT_CONFIGURED", message);
  }
  static upstream(message: string) {
    return new HttpError(502, "UPSTREAM_ERROR", message);
  }
}

export function zodFieldErrors(error: ZodError): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    (fields[key] ||= []).push(issue.message);
  }
  return fields;
}

function toHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof ZodError) {
    return new HttpError(400, "VALIDATION_ERROR", "Some fields are invalid.", zodFieldErrors(err));
  }
  if (err instanceof DbError && err.code === UNIQUE_VIOLATION) {
    return HttpError.conflict("A record with these details already exists.");
  }
  if ((err as any)?.type === "entity.parse.failed") return HttpError.badRequest("Request body is not valid JSON.");
  if ((err as any)?.type === "entity.too.large") return new HttpError(413, "BAD_REQUEST", "Request body is too large.");
  return new HttpError(500, "INTERNAL", "Something went wrong on the server.");
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const httpError = toHttpError(err);
  if (httpError.status >= 500) {
    logger.error("Request failed", { method: req.method, path: req.path, orgId: req.ctx?.orgId, err });
  }
  if (res.headersSent) return;
  const body: ErrorBody = {
    success: false,
    error: {
      code: httpError.code,
      message: httpError.message,
      ...(httpError.fields ? { fields: httpError.fields } : {}),
    },
  };
  res.status(httpError.status).json(body);
};

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, "NOT_FOUND", `No route for ${req.method} ${req.path}.`));
};
