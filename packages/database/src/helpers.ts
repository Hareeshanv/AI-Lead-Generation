export const UNIQUE_VIOLATION = "23505";
export const NOT_FOUND = "PGRST116";

export class DbError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly details?: string
  ) {
    super(message);
    this.name = "DbError";
  }
}

export function dbError(action: string, error: { message: string; code?: string; details?: string }): DbError {
  return new DbError(`Supabase ${action} failed: ${error.message}`, error.code, error.details);
}

export interface SortSpec {
  column: string;
  ascending: boolean;
}

export interface PageSpec {
  /** Inclusive row offsets for PostgREST .range(). */
  from: number;
  to: number;
  sort?: SortSpec;
}

export interface PageResult<T> {
  rows: T[];
  total: number;
}
