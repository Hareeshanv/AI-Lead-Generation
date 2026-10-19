import type { Response } from "express";
import { z } from "zod";
import type { PageSpec } from "@ai-lead-gen/database";
import { HttpError } from "./errors";
import { parse } from "./validate";

export const MAX_PAGE_SIZE = 100;

const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
  /** "column" or "column:asc" / "column:desc"; a leading "-" also means desc. */
  sort: z.string().trim().optional(),
  q: z.string().trim().max(200).optional(),
});

export interface Pagination extends PageSpec {
  page: number;
  pageSize: number;
  q?: string;
}

/**
 * Reads page / pageSize / sort / q from the query string. Sort columns are API field names
 * mapped to DB columns through `sortable` (anything else is rejected).
 */
export function parsePagination(
  query: unknown,
  options: { sortable: Record<string, string>; defaultSort?: string }
): Pagination {
  const { page, pageSize, sort, q } = parse(paginationQuery, query ?? {});
  const raw = sort || options.defaultSort;
  let sortSpec: PageSpec["sort"];
  if (raw) {
    const desc = raw.startsWith("-") || raw.toLowerCase().endsWith(":desc");
    const field = raw.replace(/^-/, "").replace(/:(asc|desc)$/i, "");
    const column = options.sortable[field];
    if (!column) {
      throw HttpError.badRequest(`Cannot sort by "${field}". Use one of: ${Object.keys(options.sortable).join(", ")}.`);
    }
    sortSpec = { column, ascending: !desc };
  }
  const from = (page - 1) * pageSize;
  return { page, pageSize, from, to: from + pageSize - 1, sort: sortSpec, q: q || undefined };
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** List response: { data: T[], meta: { page, pageSize, total, totalPages } }. */
export function sendPage<T>(res: Response, rows: T[], total: number, p: Pick<Pagination, "page" | "pageSize">) {
  const meta: PageMeta = {
    page: p.page,
    pageSize: p.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / p.pageSize)),
  };
  res.json({ data: rows, meta });
}

/** Single-resource response: { data }. */
export function send<T>(res: Response, data: T, status = 200) {
  res.status(status).json({ data });
}
