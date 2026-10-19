import { deleteData, enc, getData, getPage, patchData, postData } from "./http";
import { mapActivityRow, mapTaskRow, toQueryParams } from "./leads";
import type {
  Activity,
  ActivityInput,
  BulkCreateDealsInput,
  BulkCreateDealsResult,
  Deal,
  DealBoard,
  DealBoardParams,
  DealInput,
  DealListParams,
  DealStage,
  PageParams,
  Paginated,
  Task,
  TaskInput,
  TaskListParams,
  TaskPatch,
} from "@/types";

import { one, type ActivityRow, type DealBoardColumnRow, type DealRow, type TaskRow } from "./rows";

export const mapDealRow = (d: DealRow): Deal => {
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
    const rows = await getData<DealRow[]>("/deals", { params: toQueryParams(params) });
    return Array.isArray(rows) ? rows.map(mapDealRow) : [];
  },

  board: async ({ expand, ...params }: DealBoardParams = {}): Promise<DealBoard> => {
    const expandParam = Object.entries(expand ?? {})
      .map(([stage, limit]) => `${stage}:${limit}`)
      .join(",");
    const data = await getData<{ stages?: DealBoardColumnRow[] }>("/deals/board", {
      params: toQueryParams({ ...params, expand: expandParam || undefined }),
    });
    return {
      stages: (data.stages ?? []).map((s) => ({
        stage: s.stage,
        deals: Array.isArray(s.deals) ? s.deals.map(mapDealRow) : [],
        count: Number(s.count) || 0,
        value: Number(s.value) || 0,
        weighted: Number(s.weighted) || 0,
      })),
    };
  },

  bulkCreate: async (input: BulkCreateDealsInput): Promise<BulkCreateDealsResult> => {
    const data = await postData<{ created: number; missing?: string[]; deals?: DealRow[] }>("/deals/bulk", input);
    return { created: Number(data.created) || 0, missing: data.missing ?? [], deals: (data.deals ?? []).map(mapDealRow) };
  },

  get: async (id: string): Promise<Deal> => mapDealRow(await getData<DealRow>(`/deals/${enc(id)}`)),

  create: async (input: DealInput): Promise<Deal> => mapDealRow(await postData<DealRow>("/deals", input)),

  update: async (id: string, patch: DealInput): Promise<Deal> => mapDealRow(await patchData<DealRow>(`/deals/${enc(id)}`, patch)),

  updateStage: async (id: string, stage: DealStage, options: { position?: number; lostReason?: string | null } = {}): Promise<Deal> =>
    mapDealRow(await patchData<DealRow>(`/deals/${enc(id)}/stage`, { stage, ...options })),

  remove: (id: string) => deleteData(`/deals/${enc(id)}`),

  activities: async (id: string): Promise<Activity[]> =>
    (await getData<ActivityRow[]>(`/deals/${enc(id)}/activities`)).map(mapActivityRow),

  addActivity: async (id: string, input: ActivityInput): Promise<Activity> =>
    mapActivityRow(await postData<ActivityRow>(`/deals/${enc(id)}/activities`, input)),

  tasks: async (id: string): Promise<Task[]> => (await getData<TaskRow[]>(`/deals/${enc(id)}/tasks`)).map(mapTaskRow),

  addTask: async (id: string, input: TaskInput): Promise<Task> => mapTaskRow(await postData<TaskRow>(`/deals/${enc(id)}/tasks`, input)),
};

/** Follow-up tasks across leads and deals. */
export const taskApi = {
  list: async (params: TaskListParams = {}): Promise<Task[]> =>
    (await getData<TaskRow[]>("/tasks", { params: toQueryParams(params) })).map(mapTaskRow),

  listPage: async (params: TaskListParams & PageParams = {}): Promise<Paginated<Task>> => {
    const page = await getPage<TaskRow>("/tasks", { ...params });
    return { data: (page.data ?? []).map(mapTaskRow), meta: page.meta };
  },

  update: async (id: string, patch: TaskPatch): Promise<Task> => mapTaskRow(await patchData<TaskRow>(`/tasks/${enc(id)}`, patch)),

  remove: (id: string) => deleteData(`/tasks/${enc(id)}`),
};

export const activityApi = {
  remove: (id: string) => deleteData(`/activities/${enc(id)}`),
};
