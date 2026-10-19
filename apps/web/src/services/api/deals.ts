import { deleteData, enc, getData, patchData, postData } from "./http";
import { mapActivityRow, mapTaskRow, toQueryParams } from "./leads";
import type {
  Activity,
  ActivityInput,
  Deal,
  DealInput,
  DealListParams,
  DealStage,
  Task,
  TaskInput,
  TaskListParams,
  TaskPatch,
} from "@/types";

const one = (v: any) => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export const mapDealRow = (d: any): Deal => {
  const lead = one(d.lead);
  return {
    id: d.id,
    title: d.title ?? "Untitled deal",
    company: d.company ?? "",
    contact: d.contact ?? "",
    value: Number(d.value) || 0,
    stage: d.stage ?? "New",
    probability: Number(d.probability) || 0,
    expectedClose: d.expected_close ?? "",
    owner: d.owner ?? "",
    ownerId: d.owner_id ?? null,
    leadId: d.lead_id ?? null,
    lead: lead
      ? {
          id: lead.id,
          name: lead.name ?? "Unknown",
          company: lead.company ?? "",
          email: lead.email ?? null,
          phone: lead.phone ?? null,
          status: lead.status ?? null,
          score: lead.score ?? null,
        }
      : null,
    nextFollowUpAt: d.next_follow_up_at ?? null,
    lostReason: d.lost_reason ?? null,
    position: Number(d.position) || 0,
    closedAt: d.closed_at ?? null,
    createdAt: d.created_at,
    updatedAt: d.updated_at ?? d.created_at,
  };
};

/** Owned by the CRM module. */
export const dealApi = {
  list: async (params: DealListParams = {}): Promise<Deal[]> => {
    const rows = await getData<any[]>("/deals", { params: toQueryParams(params) });
    return Array.isArray(rows) ? rows.map(mapDealRow) : [];
  },

  get: async (id: string): Promise<Deal> => mapDealRow(await getData<any>(`/deals/${enc(id)}`)),

  create: async (input: DealInput): Promise<Deal> => mapDealRow(await postData<any>("/deals", input)),

  update: async (id: string, patch: DealInput): Promise<Deal> => mapDealRow(await patchData<any>(`/deals/${enc(id)}`, patch)),

  updateStage: async (id: string, stage: DealStage, options: { position?: number; lostReason?: string | null } = {}): Promise<Deal> =>
    mapDealRow(await patchData<any>(`/deals/${enc(id)}/stage`, { stage, ...options })),

  remove: (id: string) => deleteData(`/deals/${enc(id)}`),

  activities: async (id: string): Promise<Activity[]> =>
    (await getData<any[]>(`/deals/${enc(id)}/activities`)).map(mapActivityRow),

  addActivity: async (id: string, input: ActivityInput): Promise<Activity> =>
    mapActivityRow(await postData<any>(`/deals/${enc(id)}/activities`, input)),

  tasks: async (id: string): Promise<Task[]> => (await getData<any[]>(`/deals/${enc(id)}/tasks`)).map(mapTaskRow),

  addTask: async (id: string, input: TaskInput): Promise<Task> => mapTaskRow(await postData<any>(`/deals/${enc(id)}/tasks`, input)),
};

/** Follow-up tasks across leads and deals. */
export const taskApi = {
  list: async (params: TaskListParams = {}): Promise<Task[]> =>
    (await getData<any[]>("/tasks", { params: toQueryParams(params) })).map(mapTaskRow),

  update: async (id: string, patch: TaskPatch): Promise<Task> => mapTaskRow(await patchData<any>(`/tasks/${enc(id)}`, patch)),

  remove: (id: string) => deleteData(`/tasks/${enc(id)}`),
};

export const activityApi = {
  remove: (id: string) => deleteData(`/activities/${enc(id)}`),
};
