import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from "axios";
import { getSupabase } from "@/lib/supabase/client";
import { getActiveOrgId, setActiveOrgId } from "@/lib/auth";
import type { ApiErrorBody, Paginated, PageParams } from "@/types";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

/** Every failed API call rejects with this; `message` is safe to show to users. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string[]>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.fields = body.fields;
  }
}

export const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60_000,
  headers: { "Content-Type": "application/json" },
});

http.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  if (typeof window === "undefined") return config;
  const {
    data: { session },
  } = await getSupabase().auth.getSession();
  if (session?.access_token) config.headers.set("Authorization", `Bearer ${session.access_token}`);
  const orgId = getActiveOrgId();
  if (orgId) config.headers.set("x-org-id", orgId);
  return config;
});

type RetriableConfig = InternalAxiosRequestConfig & { _orgRetried?: boolean };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function toApiError(err: AxiosError): ApiError {
  if (!err.response) {
    if (err.code === "ECONNABORTED") return new ApiError(0, { code: "TIMEOUT", message: "The request timed out. Try again." });
    return new ApiError(0, { code: "NETWORK_ERROR", message: "Can't reach the server. Check your connection and try again." });
  }
  const { status } = err.response;
  let data: unknown = err.response.data;
  // Text/blob downloads (CSV export) receive the JSON error body as a string.
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      // not JSON
    }
  }
  const body = isRecord(data) ? data.error : undefined;
  if (isRecord(body) && typeof body.message === "string") {
    return new ApiError(status, { code: String(body.code || "ERROR"), message: body.message, fields: body.fields as ApiErrorBody["fields"] });
  }
  // Legacy endpoints answer { success: false, error: "message" }.
  if (typeof body === "string") return new ApiError(status, { code: "ERROR", message: body });
  return new ApiError(status, { code: "ERROR", message: `Request failed (${status}).` });
}

let redirectingToLogin = false;

http.interceptors.response.use(undefined, async (err: AxiosError) => {
  const apiError = toApiError(err);
  const config = err.config as RetriableConfig | undefined;

  // A stale workspace id (removed from that workspace): fall back to the default workspace once.
  if (apiError.code === "NOT_A_MEMBER" && config && !config._orgRetried && getActiveOrgId()) {
    setActiveOrgId(null);
    config._orgRetried = true;
    config.headers.delete("x-org-id");
    return http.request(config);
  }

  if (apiError.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login") && !redirectingToLogin) {
    redirectingToLogin = true;
    const next = `${window.location.pathname}${window.location.search}`;
    // The middleware sends signed-in users from /login back to the app, so the session the API rejected must be cleared first.
    await getSupabase().auth.signOut({ scope: "local" }).catch(() => undefined);
    window.location.assign(`/login?next=${encodeURIComponent(next)}`);
  }
  return Promise.reject(apiError);
});

/** Unwraps `{ data }` responses. */
export async function getData<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const res = await http.get<{ data: T }>(url, config);
  return res.data.data;
}

export async function getPage<T>(url: string, params: PageParams & Record<string, unknown> = {}): Promise<Paginated<T>> {
  const res = await http.get<Paginated<T>>(url, { params });
  return res.data;
}

export async function postData<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const res = await http.post<{ data: T }>(url, body, config);
  return res.data.data;
}

export async function patchData<T>(url: string, body?: unknown): Promise<T> {
  const res = await http.patch<{ data: T }>(url, body);
  return res.data.data;
}

export async function putData<T>(url: string, body?: unknown): Promise<T> {
  const res = await http.put<{ data: T }>(url, body);
  return res.data.data;
}

export async function deleteData(url: string): Promise<void> {
  await http.delete(url);
}

/** DELETE that answers `{ data }`. */
export async function deleteWithData<T>(url: string): Promise<T> {
  const res = await http.delete<{ data: T }>(url);
  return res.data.data;
}

export const enc = encodeURIComponent;
