export type TestUserKey = "adminA" | "managerA" | "memberA" | "adminB" | "adminC";

export interface TestUser {
  id: string;
  email: string;
  token: string;
  orgId: string;
}

export type DbContext =
  | { ok: false; reason: string }
  | {
      ok: true;
      url: string;
      serviceKey: string;
      anonKey: string;
      source: string;
      runId: string;
      users: Record<TestUserKey, TestUser>;
    };

declare module "vitest" {
  export interface ProvidedContext {
    db: DbContext;
  }
}
