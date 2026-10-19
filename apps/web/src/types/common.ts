export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Shape of paginated API responses: `{ data, meta }`. */
export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

export interface PageParams {
  page?: number;
  pageSize?: number;
  /** Column name; prefix with "-" for descending, e.g. "-created_at". */
  sort?: string;
  q?: string;
}

/** Normalized API error (see `ApiError` in services/api/http.ts). */
export interface ApiErrorBody {
  code: string;
  message: string;
  fields?: Record<string, string[]>;
}
