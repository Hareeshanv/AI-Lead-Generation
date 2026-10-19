import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessagingError } from "../../services/messaging/errors";
import {
  WHATSAPP_UNDELIVERABLE_CODES,
  parseWhatsAppWebhook,
  sendWhatsAppTemplate,
  verifyMetaSignature,
  type WhatsAppTemplateInput,
} from "../../services/messaging/whatsapp";

const APP_SECRET = "meta-app-secret";
const RAW = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
const sig = (body: string | Buffer, secret = APP_SECRET) => `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;

describe("verifyMetaSignature", () => {
  it("accepts a valid signature for string and Buffer bodies", () => {
    expect(verifyMetaSignature(APP_SECRET, sig(RAW), RAW)).toBe(true);
    expect(verifyMetaSignature(APP_SECRET, sig(RAW), Buffer.from(RAW))).toBe(true);
  });

  it("accepts upper-case hex", () => {
    expect(verifyMetaSignature(APP_SECRET, `sha256=${sig(RAW).slice(7).toUpperCase()}`, RAW)).toBe(true);
  });

  it("rejects the wrong secret or a modified body", () => {
    expect(verifyMetaSignature(APP_SECRET, sig(RAW, "other"), RAW)).toBe(false);
    expect(verifyMetaSignature(APP_SECRET, sig(RAW), `${RAW} `)).toBe(false);
  });

  it("rejects missing or malformed headers", () => {
    const hex = sig(RAW).slice(7);
    expect(verifyMetaSignature(APP_SECRET, undefined, RAW)).toBe(false);
    expect(verifyMetaSignature(APP_SECRET, "", RAW)).toBe(false);
    expect(verifyMetaSignature(APP_SECRET, hex, RAW)).toBe(false);
    expect(verifyMetaSignature(APP_SECRET, `sha1=${hex}`, RAW)).toBe(false);
    expect(verifyMetaSignature(APP_SECRET, "sha256=", RAW)).toBe(false);
    expect(verifyMetaSignature(APP_SECRET, "sha256=zz-not-hex", RAW)).toBe(false);
    expect(verifyMetaSignature(APP_SECRET, `sha256=${hex.slice(0, 40)}`, RAW)).toBe(false);
  });

  it("rejects an empty secret", () => {
    expect(verifyMetaSignature("", sig(RAW, ""), RAW)).toBe(false);
  });
});

describe("parseWhatsAppWebhook", () => {
  const ts = (iso: string) => String(Date.parse(iso) / 1000);
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "PN1", display_phone_number: "15550001111" },
              statuses: [
                { id: "wamid.S1", status: "sent", recipient_id: "919845012345", timestamp: ts("2026-03-02T10:00:00Z") },
                { id: "wamid.S2", status: "read", timestamp: ts("2026-03-02T10:01:00Z") },
                {
                  id: "wamid.S3",
                  status: "failed",
                  recipient_id: "919845012345",
                  timestamp: ts("2026-03-02T10:02:00Z"),
                  errors: [{ code: 131026, title: "Message undeliverable", error_data: { details: "Receiver is incapable" } }],
                },
                { id: "wamid.S4", status: "failed", timestamp: ts("2026-03-02T10:03:00Z"), errors: [{ code: 131000, message: "Something went wrong" }] },
                { id: "wamid.S5", status: "failed", timestamp: ts("2026-03-02T10:04:00Z"), errors: [{}] },
                { id: "wamid.S6", status: "deleted", timestamp: ts("2026-03-02T10:05:00Z") },
                { status: "sent", timestamp: ts("2026-03-02T10:05:00Z") },
              ],
              messages: [
                {
                  id: "wamid.M1",
                  from: "919845012345",
                  timestamp: ts("2026-03-02T11:00:00Z"),
                  type: "text",
                  text: { body: "Interested!" },
                  context: { id: "wamid.S1" },
                },
                { id: "wamid.M2", from: "919845012345", timestamp: ts("2026-03-02T11:01:00Z"), type: "button", button: { payload: "STOP_PAYLOAD" } },
                {
                  id: "wamid.M3",
                  from: "919845012345",
                  timestamp: ts("2026-03-02T11:02:00Z"),
                  type: "interactive",
                  interactive: { type: "list_reply", list_reply: { id: "x", title: "Weekend batch" } },
                },
                { id: "wamid.M4", from: "919845012345", timestamp: ts("2026-03-02T11:03:00Z"), type: "image", image: { caption: "My marksheet" } },
                { id: "wamid.M5", from: "919845012345", timestamp: ts("2026-03-02T11:04:00Z"), type: "sticker", sticker: {} },
                { id: "wamid.M6", timestamp: ts("2026-03-02T11:05:00Z"), type: "text", text: { body: "no sender" } },
                { from: "919845012345", type: "text", text: { body: "no id" } },
              ],
            },
          },
        ],
      },
      { id: "WABA2", changes: [{ value: { statuses: [{ id: "wamid.X", status: "delivered", timestamp: ts("2026-03-02T12:00:00Z") }] } }] },
      { id: "WABA3" },
      null,
    ],
  };

  it("flattens statuses with errors", () => {
    const { statuses } = parseWhatsAppWebhook(payload);
    expect(statuses).toEqual([
      { phoneNumberId: "PN1", providerMessageId: "wamid.S1", status: "sent", recipient: "919845012345", at: "2026-03-02T10:00:00.000Z", error: null, errorCode: null },
      { phoneNumberId: "PN1", providerMessageId: "wamid.S2", status: "read", recipient: null, at: "2026-03-02T10:01:00.000Z", error: null, errorCode: null },
      {
        phoneNumberId: "PN1",
        providerMessageId: "wamid.S3",
        status: "failed",
        recipient: "919845012345",
        at: "2026-03-02T10:02:00.000Z",
        error: "Receiver is incapable",
        errorCode: 131026,
      },
      {
        phoneNumberId: "PN1",
        providerMessageId: "wamid.S4",
        status: "failed",
        recipient: null,
        at: "2026-03-02T10:03:00.000Z",
        error: "Something went wrong",
        errorCode: 131000,
      },
      {
        phoneNumberId: "PN1",
        providerMessageId: "wamid.S5",
        status: "failed",
        recipient: null,
        at: "2026-03-02T10:04:00.000Z",
        error: "Delivery failed",
        errorCode: null,
      },
      { phoneNumberId: null, providerMessageId: "wamid.X", status: "delivered", recipient: null, at: "2026-03-02T12:00:00.000Z", error: null, errorCode: null },
    ]);
  });

  it("flattens inbound messages and extracts their text", () => {
    const { messages } = parseWhatsAppWebhook(payload);
    expect(messages.map((m) => [m.providerMessageId, m.type, m.text, m.contextId])).toEqual([
      ["wamid.M1", "text", "Interested!", "wamid.S1"],
      ["wamid.M2", "button", "STOP_PAYLOAD", null],
      ["wamid.M3", "interactive", "Weekend batch", null],
      ["wamid.M4", "image", "My marksheet", null],
      ["wamid.M5", "sticker", null, null],
    ]);
    expect(messages[0]).toEqual({
      phoneNumberId: "PN1",
      providerMessageId: "wamid.M1",
      from: "919845012345",
      contextId: "wamid.S1",
      type: "text",
      text: "Interested!",
      at: "2026-03-02T11:00:00.000Z",
    });
  });

  it("prefers button text and button-reply titles", () => {
    const body = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { id: "a", from: "1", type: "button", button: { text: "Yes please", payload: "YES" } },
                  { id: "b", from: "1", type: "interactive", interactive: { button_reply: { id: "y", title: "Call me" } } },
                  { id: "c", from: "1" },
                ],
              },
            },
          ],
        },
      ],
    };
    const { messages } = parseWhatsAppWebhook(body);
    expect(messages.map((m) => m.text)).toEqual(["Yes please", "Call me", null]);
    expect(messages[2].type).toBe("unknown");
  });

  it("uses the current time when the timestamp is missing or invalid", () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 2, 2, 9, 0, 0) });
    try {
      const body = {
        object: "whatsapp_business_account",
        entry: [{ changes: [{ value: { statuses: [{ id: "s", status: "sent", timestamp: "abc" }, { id: "t", status: "sent", timestamp: "0" }] } }] }],
      };
      expect(parseWhatsAppWebhook(body).statuses.map((s) => s.at)).toEqual(["2026-03-02T09:00:00.000Z", "2026-03-02T09:00:00.000Z"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([null, undefined, {}, { object: "page", entry: [] }, { object: "whatsapp_business_account" }, { object: "whatsapp_business_account", entry: {} }])(
    "returns nothing for %j",
    (body) => {
      expect(parseWhatsAppWebhook(body)).toEqual({ statuses: [], messages: [] });
    }
  );
});

describe("WHATSAPP_UNDELIVERABLE_CODES", () => {
  it("treats unreachable numbers as bounces but not transient errors", () => {
    expect(WHATSAPP_UNDELIVERABLE_CODES.has(131026)).toBe(true);
    expect(WHATSAPP_UNDELIVERABLE_CODES.has(131021)).toBe(true);
    expect(WHATSAPP_UNDELIVERABLE_CODES.has(131000)).toBe(false);
  });
});

describe("sendWhatsAppTemplate", () => {
  const input: WhatsAppTemplateInput = {
    phoneNumberId: "PN 1/2",
    accessToken: "EAAG-test",
    to: "919845012345",
    template: { name: "course_offer", language: "en", components: [{ type: "body", parameters: [{ type: "text", text: "Asha" }] }] },
  };
  const graphError = (status: number, error: Record<string, unknown>) =>
    new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json" } });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts the template and returns the wamid", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.OUT" }] }), { status: 200 }));
    await expect(sendWhatsAppTemplate(input)).resolves.toEqual({ id: "wamid.OUT" });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v21.0/PN%201%2F2/messages");
    expect(init.headers).toEqual({ Authorization: "Bearer EAAG-test", "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "919845012345",
      type: "template",
      template: { name: "course_offer", language: { code: "en" }, components: input.template.components },
    });
  });

  it("omits empty components", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "w" }] }), { status: 200 }));
    await sendWhatsAppTemplate({ ...input, template: { name: "hello_world", language: "en_US", components: [] } });
    expect(JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string).template).toEqual({
      name: "hello_world",
      language: { code: "en_US" },
    });
  });

  it.each([
    [190, "Invalid OAuth access token", " The access token is invalid or expired."],
    [132001, "Template name does not exist", " The template name or language does not exist or is not approved."],
    [132000, "Number of parameters does not match", " The number of template parameters does not match the approved template."],
  ])("explains Graph error %i", async (code, message, hint) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(graphError(400, { code, message }));
    const err = await sendWhatsAppTemplate(input).catch((e) => e);
    expect(err).toBeInstanceOf(MessagingError);
    expect(err.message).toBe(`WhatsApp rejected the message (${code}): ${message}.${hint}`);
    expect(err.retryable).toBe(false);
    expect(err.providerCode).toBe(code);
  });

  it("prefers error_data details over the message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      graphError(400, { code: 131009, message: "(#131009) Parameter value is not valid", error_data: { details: "Invalid phone" } })
    );
    await expect(sendWhatsAppTemplate(input)).rejects.toMatchObject({ message: "WhatsApp rejected the message (131009): Invalid phone." });
  });

  it("retries throttling codes even on a 400", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(graphError(400, { code: 130429, message: "Rate limit hit" }));
    await expect(sendWhatsAppTemplate(input)).rejects.toMatchObject({ retryable: true, status: 400, providerCode: 130429 });
  });

  it("retries server errors without a Graph error body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("busy", { status: 503, statusText: "Service Unavailable" }));
    await expect(sendWhatsAppTemplate(input)).rejects.toMatchObject({
      retryable: true,
      status: 503,
      message: "WhatsApp rejected the message (503): Service Unavailable.",
    });
  });

  it("fails when no message id is returned", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ messages: [] }), { status: 200 }));
    await expect(sendWhatsAppTemplate(input)).rejects.toMatchObject({
      message: "WhatsApp accepted the message but returned no id.",
      retryable: false,
    });
  });

  it("turns network errors into retryable errors", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("socket hang up"));
    await expect(sendWhatsAppTemplate(input)).rejects.toMatchObject({
      message: "Request to graph.facebook.com failed: socket hang up",
      retryable: true,
    });
  });
});
