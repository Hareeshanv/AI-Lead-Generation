import { z, type ZodTypeAny } from "zod";
import { HttpError, zodFieldErrors } from "./errors";

/** Parses input with a zod schema; throws a 400 VALIDATION_ERROR with per-field messages. */
export function parse<S extends ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new HttpError(400, "VALIDATION_ERROR", "Some fields are invalid.", zodFieldErrors(result.error));
  }
  return result.data;
}

export const uuidParam = z.string().uuid("Invalid id");

/** Route param that must be a UUID. */
export function parseId(value: unknown, what = "id"): string {
  const result = uuidParam.safeParse(value);
  if (!result.success) throw HttpError.badRequest(`Invalid ${what}.`);
  return result.data;
}

/** Query-string boolean: "true"/"1" -> true, "false"/"0" -> false. */
export const queryBoolean = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((v) => v === true || v === "true" || v === "1");

/** Query-string list: "a,b" or repeated ?x=a&x=b. */
export const queryList = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v : v.split(",")).map((s) => s.trim()).filter(Boolean));
