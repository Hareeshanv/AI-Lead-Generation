/**
 * React Query keys. Each module adds its own entry here (one line) and keeps hooks in hooks/use<Module>.ts.
 * Keys start with the module name so `invalidateQueries({ queryKey: queryKeys.leads.all })` clears a whole module.
 */
export const queryKeys = {
  me: ["me"] as const,
  /** Under "me" so invalidating the account also refreshes the caller's pending invitations. */
  myInvitations: ["me", "invitations"] as const,
  settings: ["settings"] as const,
  members: ["members"] as const,
  invitations: ["invitations"] as const,
  leads: {
    all: ["leads"] as const,
    list: (params: object) => ["leads", "list", params] as const,
    detail: (id: string) => ["leads", "detail", id] as const,
    facets: ["leads", "facets"] as const,
    search: (filters: object) => ["leads", "search", filters] as const,
    activities: (id: string) => ["leads", "activities", id] as const,
    tasks: (id: string) => ["leads", "tasks", id] as const,
  },
  deals: {
    all: ["deals"] as const,
    list: (params: object) => ["deals", "list", params] as const,
    board: (params: object) => ["deals", "board", params] as const,
    detail: (id: string) => ["deals", "detail", id] as const,
    activities: (id: string) => ["deals", "activities", id] as const,
    tasks: (id: string) => ["deals", "tasks", id] as const,
  },
  tasks: {
    all: ["tasks"] as const,
    list: (params: object) => ["tasks", "list", params] as const,
    page: (params: object) => ["tasks", "page", params] as const,
  },
  campaigns: {
    all: ["campaigns"] as const,
    list: (params: object) => ["campaigns", "list", params] as const,
    detail: (id: string) => ["campaigns", "detail", id] as const,
    recipients: (id: string, params: object) => ["campaigns", "recipients", id, params] as const,
    preview: (params: object) => ["campaigns", "preview", params] as const,
  },
  agents: { all: ["agents"] as const },
  workflows: { all: ["workflows"] as const },
  analytics: { all: ["analytics"] as const },
  integrations: { all: ["integrations"] as const },
  notifications: { all: ["notifications"] as const },
};
