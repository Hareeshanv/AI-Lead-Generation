import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { anonymous, errorBody, hasDb } from "./support/helpers";

/** Endpoints that answer without touching the database (run even when no test DB is available). */

const SVIX_KEY = crypto.randomBytes(24);
const SVIX_SECRET = `whsec_${SVIX_KEY.toString("base64")}`;
const META_SECRET = "meta-app-secret-for-tests";
const VERIFY_TOKEN = "verify-token-for-tests";

function svixHeaders(body: string, { secretKey = SVIX_KEY, timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const id = `msg_${crypto.randomBytes(6).toString("hex")}`;
  const sig = crypto.createHmac("sha256", secretKey).update(`${id}.${timestamp}.${body}`).digest("base64");
  return { "svix-id": id, "svix-timestamp": String(timestamp), "svix-signature": `v1,${sig}`, "content-type": "application/json" };
}

const metaSignature = (body: string, secret = META_SECRET) =>
  `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;

describe("authentication", () => {
  it.each([
    ["get", "/api/leads"],
    ["post", "/api/leads"],
    ["get", "/api/deals"],
    ["get", "/api/campaigns"],
    ["post", "/api/campaigns/00000000-0000-0000-0000-000000000000/launch"],
    ["get", "/api/workflows"],
    ["get", "/api/analytics/summary"],
    ["get", "/api/settings"],
    ["get", "/api/members"],
    ["get", "/api/invitations"],
    ["get", "/api/integrations"],
    ["get", "/api/notifications"],
    ["get", "/api/agents"],
    ["get", "/api/me"],
  ] as const)("%s %s without a token is 401 with the standard error body", async (method, url) => {
    const res = await anonymous()[method](url);
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(errorBody(res).code).toBe("UNAUTHORIZED");
  });

  it("rejects a non-Bearer Authorization header", async () => {
    const res = await anonymous().get("/api/leads").set("Authorization", "Basic abc");
    expect(res.status).toBe(401);
  });

  it.skipIf(!hasDb())("rejects a forged token", async () => {
    const res = await anonymous().get("/api/leads").set("Authorization", "Bearer not-a-real-jwt");
    expect(res.status).toBe(401);
    expect(errorBody(res).code).toBe("UNAUTHORIZED");
  });
});

describe("routing and errors", () => {
  it("unknown API routes return 404 with the error body", async () => {
    const res = await anonymous().get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
  });

  it("malformed JSON is a 400, not a 500", async () => {
    const res = await anonymous().post("/api/webhooks/resend").set("content-type", "application/json").send("{not json");
    expect(res.status).toBe(400);
    expect(errorBody(res).code).toBe("BAD_REQUEST");
  });

  it("health never leaks configuration and reports the database state", async () => {
    const res = await anonymous().get("/api/health");
    expect([200, 503]).toContain(res.status);
    expect(res.body.database).toBe(hasDb() ? "connected" : "not_configured");
    expect(JSON.stringify(res.body)).not.toMatch(/key|secret|password/i);
  });

  it("CORS allows the web origin and refuses others", async () => {
    const ok = await anonymous().options("/api/leads").set("Origin", "http://localhost:3000").set("Access-Control-Request-Method", "GET");
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    const bad = await anonymous().options("/api/leads").set("Origin", "https://evil.example").set("Access-Control-Request-Method", "GET");
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("does not advertise Express", async () => {
    const res = await anonymous().get("/api/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("Resend webhook signature", () => {
  const body = JSON.stringify({ type: "email.delivered", created_at: new Date().toISOString(), data: {} });

  afterEach(() => {
    delete process.env.RESEND_WEBHOOK_SECRET;
  });

  it("is 401 when no signing secret is configured", async () => {
    const res = await anonymous().post("/api/webhooks/resend").set(svixHeaders(body)).send(body);
    expect(res.status).toBe(401);
  });

  describe("with RESEND_WEBHOOK_SECRET", () => {
    beforeEach(() => {
      process.env.RESEND_WEBHOOK_SECRET = SVIX_SECRET;
    });

    it("accepts a valid signature", async () => {
      const res = await anonymous().post("/api/webhooks/resend").set(svixHeaders(body)).send(body);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ received: true, handled: false });
    });

    it("rejects a signature made with another key", async () => {
      const res = await anonymous().post("/api/webhooks/resend").set(svixHeaders(body, { secretKey: crypto.randomBytes(24) })).send(body);
      expect(res.status).toBe(401);
      expect(errorBody(res).code).toBe("UNAUTHORIZED");
    });

    it("rejects a tampered body", async () => {
      const headers = svixHeaders(body);
      const res = await anonymous().post("/api/webhooks/resend").set(headers).send(body.replace("delivered", "bounced"));
      expect(res.status).toBe(401);
    });

    it("rejects a stale timestamp (replay)", async () => {
      const res = await anonymous()
        .post("/api/webhooks/resend")
        .set(svixHeaders(body, { timestamp: Math.floor(Date.now() / 1000) - 3600 }))
        .send(body);
      expect(res.status).toBe(401);
    });

    it("rejects missing signature headers", async () => {
      const res = await anonymous().post("/api/webhooks/resend").set("content-type", "application/json").send(body);
      expect(res.status).toBe(401);
    });
  });
});

describe("WhatsApp webhook", () => {
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

  beforeEach(() => {
    process.env.WHATSAPP_VERIFY_TOKEN = VERIFY_TOKEN;
    process.env.WHATSAPP_APP_SECRET = META_SECRET;
  });
  afterEach(() => {
    delete process.env.WHATSAPP_VERIFY_TOKEN;
    delete process.env.WHATSAPP_APP_SECRET;
  });

  it("echoes the challenge for the right verify token", async () => {
    const res = await anonymous()
      .get("/api/webhooks/whatsapp")
      .query({ "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "12345" });
    expect(res.status).toBe(200);
    expect(res.text).toBe("12345");
  });

  it("is 403 for a wrong verify token", async () => {
    const res = await anonymous()
      .get("/api/webhooks/whatsapp")
      .query({ "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "12345" });
    expect(res.status).toBe(403);
  });

  it("is 404 for a malformed org id in the callback URL", async () => {
    const res = await anonymous().get("/api/webhooks/whatsapp/not-a-uuid").query({ "hub.mode": "subscribe" });
    expect(res.status).toBe(404);
  });

  it("accepts a correctly signed event", async () => {
    const res = await anonymous()
      .post("/api/webhooks/whatsapp")
      .set({ "content-type": "application/json", "x-hub-signature-256": metaSignature(body) })
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  it("rejects a bad signature", async () => {
    const res = await anonymous()
      .post("/api/webhooks/whatsapp")
      .set({ "content-type": "application/json", "x-hub-signature-256": metaSignature(body, "other-secret") })
      .send(body);
    expect(res.status).toBe(401);
  });

  it("rejects a missing signature", async () => {
    const res = await anonymous().post("/api/webhooks/whatsapp").set("content-type", "application/json").send(body);
    expect(res.status).toBe(401);
  });

  it("is 401 when no app secret is configured", async () => {
    delete process.env.WHATSAPP_APP_SECRET;
    const res = await anonymous()
      .post("/api/webhooks/whatsapp")
      .set({ "content-type": "application/json", "x-hub-signature-256": metaSignature(body) })
      .send(body);
    expect(res.status).toBe(401);
  });
});

describe("unsubscribe link", () => {
  it.each(["garbage", "00000000-0000-0000-0000-000000000000.forged-signature"])("an invalid token %s shows the not-valid page", async (token) => {
    const res = await anonymous().get(`/api/webhooks/unsubscribe/${token}`);
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/html/);
    expect(res.text).toContain("Link not valid");
  });
});
