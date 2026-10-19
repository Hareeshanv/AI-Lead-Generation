import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  get: vi.fn(),
  getSecret: vi.fn(),
}));

vi.mock("@ai-lead-gen/database", () => ({
  isDbConfigured: true,
  integrationsDb: db,
}));

vi.mock("../../apps/api/src/logger", () => {
  const log = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => log };
  return { logger: log };
});

import {
  completeCredentials,
  envCredentials,
  getProviderCredentials,
  invalidateProviderCredentials,
  isPlatformManaged,
  resolveProviderCredentials,
} from "../../apps/api/src/integrations/credentials";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  invalidateProviderCredentials();
  db.get.mockReset().mockResolvedValue(null);
  db.getSecret.mockReset().mockResolvedValue(null);
  vi.stubEnv("PLATFORM_MANAGED_PROVIDERS", "");
  vi.stubEnv("PLATFORM_MANAGED_ORG_IDS", "");
  vi.stubEnv("SERPER_API_KEY", "env-serper-key");
  vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/env");
});

describe("isPlatformManaged", () => {
  it("is off unless the provider is listed", () => {
    expect(isPlatformManaged(ORG_A, "serper")).toBe(false);
    vi.stubEnv("PLATFORM_MANAGED_PROVIDERS", "sarvam, Serper");
    expect(isPlatformManaged(ORG_A, "serper")).toBe(true);
    expect(isPlatformManaged(ORG_A, "resend")).toBe(false);
  });

  it('"*" covers every provider except Slack and outbound webhooks', () => {
    vi.stubEnv("PLATFORM_MANAGED_PROVIDERS", "*");
    expect(isPlatformManaged(ORG_A, "resend")).toBe(true);
    expect(isPlatformManaged(ORG_A, "slack")).toBe(false);
    expect(isPlatformManaged(ORG_A, "webhook")).toBe(false);
    vi.stubEnv("PLATFORM_MANAGED_PROVIDERS", "slack,webhook");
    expect(isPlatformManaged(ORG_A, "slack")).toBe(false);
  });

  it("PLATFORM_MANAGED_ORG_IDS limits it to the listed workspaces", () => {
    vi.stubEnv("PLATFORM_MANAGED_PROVIDERS", "serper");
    vi.stubEnv("PLATFORM_MANAGED_ORG_IDS", ORG_A.toUpperCase());
    expect(isPlatformManaged(ORG_A, "serper")).toBe(true);
    expect(isPlatformManaged(ORG_B, "serper")).toBe(false);
  });
});

describe("resolveProviderCredentials", () => {
  it("does not fall back to env credentials by default", async () => {
    expect(await resolveProviderCredentials(ORG_A, "serper")).toBeNull();
    expect(await resolveProviderCredentials(ORG_A, "slack")).toBeNull();
  });

  it("uses env credentials for a platform-managed provider", async () => {
    vi.stubEnv("PLATFORM_MANAGED_PROVIDERS", "serper");
    expect(await resolveProviderCredentials(ORG_A, "serper")).toEqual({
      source: "env",
      values: { apiKey: "env-serper-key" },
    });
  });

  it("prefers the workspace's own credentials", async () => {
    vi.stubEnv("PLATFORM_MANAGED_PROVIDERS", "serper");
    db.get.mockResolvedValue({ has_secret: true, config: {} });
    db.getSecret.mockResolvedValue(JSON.stringify({ apiKey: "workspace-key" }));
    expect(await resolveProviderCredentials(ORG_A, "serper")).toEqual({
      source: "vault",
      values: { apiKey: "workspace-key" },
    });
    expect(db.get).toHaveBeenCalledWith(ORG_A, "serper");
  });

  it("does not use env credentials when the stored secret is unreadable", async () => {
    db.get.mockResolvedValue({ has_secret: true, config: {} });
    db.getSecret.mockResolvedValue("not json");
    expect(await resolveProviderCredentials(ORG_A, "serper")).toBeNull();
  });

  it("merges stored config with the secret and fills defaults", async () => {
    db.get.mockResolvedValue({ has_secret: true, config: { model: "sarvam-m" } });
    db.getSecret.mockResolvedValue(JSON.stringify({ apiKey: "sarvam-key" }));
    expect(await getProviderCredentials(ORG_A, "sarvam")).toEqual({
      apiKey: "sarvam-key",
      baseUrl: "https://api.sarvam.ai",
      model: "sarvam-m",
    });
  });

  it("ignores a saved row without a secret", async () => {
    db.get.mockResolvedValue({ has_secret: false, config: { fromEmail: "a@b.co" } });
    expect(await getProviderCredentials(ORG_A, "resend")).toBeNull();
    expect(db.getSecret).not.toHaveBeenCalled();
  });

  it("falls back to platform-managed env credentials when reading the vault fails", async () => {
    vi.stubEnv("PLATFORM_MANAGED_PROVIDERS", "serper");
    db.get.mockRejectedValue(new Error("vault unavailable"));
    expect(await resolveProviderCredentials(ORG_A, "serper")).toEqual({ source: "env", values: { apiKey: "env-serper-key" } });
  });

  it("never shares env Slack or webhook targets, even when every provider is platform-managed", async () => {
    vi.stubEnv("PLATFORM_MANAGED_PROVIDERS", "*");
    vi.stubEnv("OUTBOUND_WEBHOOK_URL", "https://hooks.example.com/env");
    expect(await getProviderCredentials(ORG_A, "slack")).toBeNull();
    expect(await getProviderCredentials(ORG_A, "webhook")).toBeNull();
  });

  it("caches per workspace and provider until invalidated", async () => {
    db.get.mockResolvedValue({ has_secret: true, config: {} });
    db.getSecret.mockResolvedValue(JSON.stringify({ apiKey: "first" }));
    expect(await getProviderCredentials(ORG_A, "serper")).toEqual({ apiKey: "first" });

    db.getSecret.mockResolvedValue(JSON.stringify({ apiKey: "second" }));
    expect(await getProviderCredentials(ORG_A, "serper")).toEqual({ apiKey: "first" });
    expect(await getProviderCredentials(ORG_B, "serper")).toEqual({ apiKey: "second" });

    invalidateProviderCredentials(ORG_A, "sarvam");
    expect(await getProviderCredentials(ORG_A, "serper")).toEqual({ apiKey: "first" });
    invalidateProviderCredentials(ORG_A, "serper");
    expect(await getProviderCredentials(ORG_A, "serper")).toEqual({ apiKey: "second" });
    expect(db.get).toHaveBeenCalledTimes(3);
  });

  it("caches a missing configuration too", async () => {
    expect(await getProviderCredentials(ORG_A, "serper")).toBeNull();
    expect(await getProviderCredentials(ORG_A, "serper")).toBeNull();
    expect(db.get).toHaveBeenCalledTimes(1);
  });
});

describe("completeCredentials", () => {
  it("returns null when a required field is missing or blank", () => {
    expect(completeCredentials("resend", { apiKey: "re_1" })).toBeNull();
    expect(completeCredentials("resend", { apiKey: "re_1", fromEmail: "   " })).toBeNull();
  });

  it("trims values and drops empty optional fields", () => {
    expect(completeCredentials("resend", { apiKey: " re_1 ", fromEmail: "hi@acme.co", fromName: "" })).toEqual({
      apiKey: "re_1",
      fromEmail: "hi@acme.co",
    });
  });

  it("ignores unknown and non-string fields", () => {
    expect(completeCredentials("serper", { apiKey: "k", extra: "x" })).toEqual({ apiKey: "k" });
    expect(completeCredentials("serper", { apiKey: 123 })).toBeNull();
  });
});

describe("envCredentials", () => {
  it("reads each provider field from its env var", () => {
    vi.stubEnv("META_APP_ID", "app-1");
    vi.stubEnv("META_APP_SECRET", "secret-1");
    vi.stubEnv("META_VERIFY_TOKEN", "");
    expect(envCredentials("meta")).toEqual({ appId: "app-1", appSecret: "secret-1" });
    vi.stubEnv("META_APP_SECRET", "");
    expect(envCredentials("meta")).toBeNull();
  });
});
