import { deleteData, enc, getData, getPage, http, patchData, postData } from "./http";
import type {
  Paginated,
  Workflow,
  WorkflowInput,
  WorkflowRun,
  WorkflowRunListParams,
  WorkflowSubjectOption,
  WorkflowTestInput,
} from "@/types";
import type { DealRow, LeadRow } from "./rows";

function rowsOf<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body;
  const data = (body as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? data : [];
}

/** Owned by the Workflows module. */
export const workflowApi = {
  list: () => getData<Workflow[]>("/workflows"),
  get: (id: string) => getData<Workflow>(`/workflows/${enc(id)}`),
  create: (input: WorkflowInput) => postData<Workflow>("/workflows", input),
  update: (id: string, patch: Partial<WorkflowInput>) => patchData<Workflow>(`/workflows/${enc(id)}`, patch),
  remove: (id: string) => deleteData(`/workflows/${enc(id)}`),
  setEnabled: (id: string, enabled: boolean) =>
    postData<Workflow>(`/workflows/${enc(id)}/${enabled ? "enable" : "disable"}`),
  test: (id: string, input: WorkflowTestInput) => postData<WorkflowRun>(`/workflows/${enc(id)}/test`, input),
  runs: (id: string, params: WorkflowRunListParams = {}): Promise<Paginated<WorkflowRun>> =>
    getPage<WorkflowRun>(`/workflows/${enc(id)}/runs`, { ...params }),
  allRuns: (params: WorkflowRunListParams = {}): Promise<Paginated<WorkflowRun>> =>
    getPage<WorkflowRun>("/workflows/runs", { ...params }),
  run: (runId: string) => getData<WorkflowRun>(`/workflows/runs/${enc(runId)}`),

  /** Lead picker for the test dialog (reads the Leads module's list endpoint). */
  searchLeads: async (q: string): Promise<WorkflowSubjectOption[]> => {
    const res = await http.get("/leads", { params: { q: q || undefined, pageSize: 20 } });
    return rowsOf<Pick<LeadRow, "id" | "name" | "email" | "company" | "status">>(res.data).map((l) => ({
      id: String(l.id),
      label: l.name || l.email || "Unnamed lead",
      detail: [l.company, l.status].filter(Boolean).join(" · "),
    }));
  },

  /** Deal picker for the test dialog (reads the CRM module's list endpoint). */
  searchDeals: async (q: string): Promise<WorkflowSubjectOption[]> => {
    const res = await http.get("/deals", { params: { q: q || undefined } });
    return rowsOf<Pick<DealRow, "id" | "title" | "company" | "stage">>(res.data).slice(0, 20).map((d) => ({
      id: String(d.id),
      label: d.title || d.company || "Untitled deal",
      detail: [d.company, d.stage].filter(Boolean).join(" · "),
    }));
  },
};
