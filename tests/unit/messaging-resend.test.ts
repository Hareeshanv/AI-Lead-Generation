import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessagingError, isRetryableStatus } from "../../services/messaging/errors";
import { resendEventStatus, sendResendEmail, verifySvixSignature, type ResendEmailInput } from "../../services/messaging/resend";

const KEY = crypto.randomBytes(24);
const SECRET = `whsec_${KEY.toString("base64")}`;
const NOW_MS = Date.UTC(2026, 2, 2, 10, 0, 0);
const NOW_S = Math.floor(NOW_MS / 1000);
const BODY = JSON.stringify({ type: "email.delivered", data: { email_id: "abc" } });

function sign(id: string, timestamp: string | number, body: string, key: Buffer = KEY): string {
  return crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
}

function headers(overrides: Partial<{ id: string; timestamp: string; signature: string }> = {}) {
  const id = overrides.id ?? "msg_1";
  const timestamp = overrides.timestamp ?? String(NOW_S);
  return { id, timestamp, signature: overrides.signature ?? `v1,${sign(id, timestamp, BODY)}` };
}

describe("verifySvixSignature", () => {
  const verify = (h: Parameters<typeof verifySvixSignature>[1], body: Buffer | string = BODY, opts = {}) =>
    verifySvixSignature(SECRET, h, body, { now: NOW_MS, ...opts });

  it("accepts a valid signature for string and Buffer bodies", () => {
    expect(verify(headers())).toBe(true);
    expect(verify(headers(), Buffer.from(BODY, "utf8"))).toBe(true);
  });

  it("accepts a secret without the whsec_ prefix", () => {
    expect(verifySvixSignature(KEY.toString("base64"), headers(), BODY, { now: NOW_MS })).toBe(true);
  });

  it("accepts any matching v1 entry in a rotated signature list", () => {
    const good = sign("msg_1", NOW_S, BODY);
    expect(verify(headers({ signature: `v1,${Buffer.alloc(32).toString("base64")} v1,${good}` }))).toBe(true);
  });

  it("rejects a tampered body, id or timestamp", () => {
    expect(verify(headers(), BODY.replace("delivered", "bounced"))).toBe(false);
    const h = headers();
    expect(verify({ ...h, id: "msg_2" })).toBe(false);
    expect(verify({ ...h, timestamp: String(NOW_S + 1) })).toBe(false);
  });

  it("rejects a signature made with another key", () => {
    const other = sign("msg_1", NOW_S, BODY, crypto.randomBytes(24));
    expect(verify(headers({ signature: `v1,${other}` }))).toBe(false);
  });

  it("rejects other versions and malformed entries", () => {
    const good = sign("msg_1", NOW_S, BODY);
    expect(verify(headers({ signature: `v2,${good}` }))).toBe(false);
    expect(verify(headers({ signature: good }))).toBe(false);
    expect(verify(headers({ signature: "v1," }))).toBe(false);
    expect(verify(headers({ signature: "v1,c2hvcnQ=" }))).toBe(false);
  });

  it("enforces the timestamp tolerance (default 5 minutes, inclusive)", () => {
    for (const offset of [-300, 300]) {
      const ts = String(NOW_S + offset);
      expect(verify(headers({ timestamp: ts, signature: `v1,${sign("msg_1", ts, BODY)}` }))).toBe(true);
    }
    for (const offset of [-301, 301]) {
      const ts = String(NOW_S + offset);
      expect(verify(headers({ timestamp: ts, signature: `v1,${sign("msg_1", ts, BODY)}` }))).toBe(false);
    }
    const old = String(NOW_S - 3600);
    const oldHeaders = headers({ timestamp: old, signature: `v1,${sign("msg_1", old, BODY)}` });
    expect(verify(oldHeaders, BODY, { toleranceSeconds: 7200 })).toBe(true);
  });

  it("uses the current time by default", () => {
    vi.useFakeTimers({ now: NOW_MS });
    try {
      expect(verifySvixSignature(SECRET, headers(), BODY)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects missing inputs and non-numeric timestamps", () => {
    const h = headers();
    expect(verifySvixSignature("", h, BODY, { now: NOW_MS })).toBe(false);
    expect(verify({ ...h, id: undefined })).toBe(false);
    expect(verify({ ...h, timestamp: undefined })).toBe(false);
    expect(verify({ ...h, signature: undefined })).toBe(false);
    expect(verify({ ...h, timestamp: "soon" })).toBe(false);
  });
});

describe("resendEventStatus", () => {
  it.each([
    ["email.sent", "sent"],
    ["email.delivered", "delivered"],
    ["email.opened", "opened"],
    ["email.clicked", "clicked"],
    ["email.bounced", "bounced"],
    ["email.complained", "complained"],
    ["email.failed", "failed"],
    ["email.delivery_delayed", "delayed"],
  ])("%s -> %s", (type, status) => {
    expect(resendEventStatus(type)).toBe(status);
  });

  it.each(["", "email.scheduled", "contact.created", "EMAIL.SENT", "delivered"])("ignores %j", (type) => {
    expect(resendEventStatus(type)).toBeNull();
  });
});

describe("isRetryableStatus", () => {
  it("retries timeouts, rate limits and server errors only", () => {
    for (const s of [408, 429, 500, 502, 503]) expect(isRetryableStatus(s)).toBe(true);
    for (const s of [200, 400, 401, 403, 404, 422]) expect(isRetryableStatus(s)).toBe(false);
  });
});

describe("sendResendEmail", () => {
  const input: ResendEmailInput = {
    apiKey: "re_test_key",
    from: "Acme <hello@acme.test>",
    to: "asha@example.com",
    subject: "Hello",
    html: "<p>Hi</p>",
    text: "Hi",
  };

  const jsonResponse = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("posts the email and returns Resend's id", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(200, { id: "email_123" }));
    await expect(sendResendEmail(input)).resolves.toEqual({ id: "email_123" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({ Authorization: "Bearer re_test_key", "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      from: input.from,
      to: ["asha@example.com"],
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
    });
  });

  it("sends optional reply-to, headers, tags and idempotency key", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(200, { id: 42 }));
    await expect(
      sendResendEmail({
        ...input,
        replyTo: "team@acme.test",
        headers: { "List-Unsubscribe": "<https://u>" },
        tags: { campaign: "c1", step: "s_1" },
        idempotencyKey: "msg-1",
      })
    ).resolves.toEqual({ id: "42" });
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("msg-1");
    expect(JSON.parse(init.body as string)).toMatchObject({
      reply_to: "team@acme.test",
      headers: { "List-Unsubscribe": "<https://u>" },
      tags: [
        { name: "campaign", value: "c1" },
        { name: "step", value: "s_1" },
      ],
    });
  });

  it("omits empty headers and a null reply-to", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(200, { id: "x" }));
    await sendResendEmail({ ...input, replyTo: null, headers: {} });
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body).not.toHaveProperty("reply_to");
    expect(body).not.toHaveProperty("headers");
    expect(body).not.toHaveProperty("tags");
  });

  it("explains auth failures and does not retry them", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(403, { name: "invalid_from_address", message: "Domain not verified" }));
    const err = await sendResendEmail(input).catch((e) => e);
    expect(err).toBeInstanceOf(MessagingError);
    expect(err.message).toBe(
      "Resend rejected the email (403): Domain not verified. Check the Resend API key and that the from address is on a verified domain."
    );
    expect(err.retryable).toBe(false);
    expect(err.status).toBe(403);
    expect(err.providerCode).toBe("invalid_from_address");
  });

  it("marks rate limits and server errors as retryable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(429, { message: "Too many requests" }));
    await expect(sendResendEmail(input)).rejects.toMatchObject({ retryable: true, status: 429 });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("<html>oops</html>", { status: 502, statusText: "Bad Gateway" }));
    await expect(sendResendEmail(input)).rejects.toMatchObject({
      retryable: true,
      status: 502,
      message: "Resend rejected the email (502): Bad Gateway.",
    });
  });

  it("fails when Resend returns no id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(200, {}));
    await expect(sendResendEmail(input)).rejects.toMatchObject({
      message: "Resend accepted the email but returned no id.",
      retryable: false,
    });
  });

  it("turns network errors into retryable errors", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("getaddrinfo ENOTFOUND"));
    await expect(sendResendEmail(input)).rejects.toMatchObject({
      name: "MessagingError",
      message: "Request to api.resend.com failed: getaddrinfo ENOTFOUND",
      retryable: true,
    });
  });

  it("aborts after the timeout", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        })
    );
    const pending = sendResendEmail(input).catch((e) => e);
    await vi.advanceTimersByTimeAsync(20_000);
    const err = await pending;
    expect(err).toBeInstanceOf(MessagingError);
    expect(err.message).toBe("Request to api.resend.com failed: timed out after 20000ms");
    expect(err.retryable).toBe(true);
  });
});
