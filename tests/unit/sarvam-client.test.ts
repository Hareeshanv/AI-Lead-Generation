import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SarvamClient,
  SarvamTransportError,
  isOfficialBaseUrl,
  sarvamHttpError,
  type SarvamHttpRequest,
  type SarvamHttpResponse,
} from "../../services/sarvam";

const API_KEY = "sk-test-123456";
const ok = (content: unknown, tokens = 42): SarvamHttpResponse => ({
  status: 200,
  body: JSON.stringify({ id: "chat-1", model: "m", choices: [{ message: { content: JSON.stringify(content) } }], usage: { total_tokens: tokens } }),
});

/** Transport returning (or throwing) the scripted results in order, recording each request. */
function scripted(...steps: (SarvamHttpResponse | Error)[]) {
  const requests: SarvamHttpRequest[] = [];
  const transport = vi.fn(async (req: SarvamHttpRequest) => {
    requests.push(req);
    const step = steps.shift();
    if (!step) throw new Error("no more scripted responses");
    if (step instanceof Error) throw step;
    return step;
  });
  return { transport, requests };
}

const client = new SarvamClient({ retryBaseMs: 0 });
const call = (transport: any, extra: Record<string, unknown> = {}) =>
  client.callAgent({ agentId: "agt-query-parser", input: { query: "q" }, config: { apiKey: API_KEY, transport }, ...extra });

afterEach(() => vi.restoreAllMocks());

describe("SarvamClient.callAgent retries", () => {
  it("retries network errors and timeouts, then succeeds", async () => {
    const { transport } = scripted(new SarvamTransportError("timed out after 60s", true), new Error("socket hang up"), ok({ city: "Pune" }));
    const res = await call(transport);
    expect(res).toMatchObject({ success: true, output: { city: "Pune" }, tokensUsed: 42 });
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it("retries 429 and 5xx responses up to maxAttempts", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { transport } = scripted({ status: 503, body: "busy" }, { status: 429, body: "slow down" });
    const res = await call(transport, { maxAttempts: 2 });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(res).toMatchObject({ success: false, error: "Sarvam rate limit reached; try again later" });
  });

  it("does not retry non-retryable failures", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const auth = scripted({ status: 401, body: "bad key" });
    expect((await call(auth.transport)).error).toBe("Sarvam rejected the API key (check it under Integrations)");
    expect(auth.transport).toHaveBeenCalledTimes(1);

    const tooLarge = scripted(new SarvamTransportError("the response was too large", false));
    expect((await call(tooLarge.transport)).error).toBe("Sarvam request failed: the response was too large");
    expect(tooLarge.transport).toHaveBeenCalledTimes(1);
  });

  it("stops immediately when the base URL is rejected as unsafe", async () => {
    const unsafe = Object.assign(new Error("The URL points to a private address."), { name: "UnsafeUrlError" });
    const { transport } = scripted(unsafe);
    const res = await call(transport);
    expect(res.error).toBe("Sarvam base URL is not allowed: The URL points to a private address.");
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

describe("SarvamClient.callAgent errors and base URLs", () => {
  it("never returns the upstream error body to the caller", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { transport } = scripted({ status: 400, body: '{"error":"secret upstream detail sk-live-abc"}' });
    const res = await call(transport);
    expect(res.error).toBe("Sarvam rejected the request (check the model name under Integrations)");
    expect(JSON.stringify(res)).not.toContain("secret upstream detail");
    expect(warn).toHaveBeenCalled();
  });

  it("refuses a custom base URL without the safe transport", async () => {
    const res = await client.callAgent({
      agentId: "agt-query-parser",
      input: { query: "q" },
      config: { apiKey: API_KEY, baseUrl: "http://169.254.169.254/latest" },
    });
    expect(res).toMatchObject({ success: false, error: "A custom Sarvam base URL can only be used through the server's safe HTTP client" });
  });

  it("sends custom base URLs through the supplied transport", async () => {
    const { transport, requests } = scripted(ok({}));
    await client.callAgent({
      agentId: "agt-query-parser",
      input: { query: "q" },
      config: { apiKey: API_KEY, baseUrl: "https://llm.example.com/v1/", transport },
    });
    expect(requests[0].url).toBe("https://llm.example.com/v1/chat/completions");
  });

  it("recognises the official endpoint only", () => {
    expect(isOfficialBaseUrl("https://api.sarvam.ai")).toBe(true);
    expect(isOfficialBaseUrl("https://api.sarvam.ai/v1/")).toBe(true);
    expect(isOfficialBaseUrl("http://api.sarvam.ai")).toBe(false);
    expect(isOfficialBaseUrl("https://api.sarvam.ai:8443")).toBe(false);
    expect(isOfficialBaseUrl("https://api.sarvam.ai.evil.test")).toBe(false);
    expect(isOfficialBaseUrl("not a url")).toBe(false);
  });

  it("maps statuses to user-facing messages", () => {
    expect(sarvamHttpError(500)).toBe("Sarvam is unavailable (HTTP 500); try again later");
    expect(sarvamHttpError(404)).toBe("Sarvam endpoint not found (check the base URL under Integrations)");
    expect(sarvamHttpError(418)).toBe("Sarvam request failed (HTTP 418)");
  });
});
