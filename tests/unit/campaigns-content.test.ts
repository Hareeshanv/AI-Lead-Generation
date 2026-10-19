import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEmailBodies,
  buildWhatsAppTemplate,
  isOptOutText,
  publicApiUrl,
  renderTemplate,
  templateVariables,
  unsubscribeConfigured,
  unsubscribeToken,
  unsubscribeUrl,
  verifyUnsubscribeToken,
  whatsappTemplateSchema,
} from "../../apps/api/src/campaigns/content";

const MESSAGE_ID = "5b1f0c3a-2d4e-4f6a-8b7c-9d0e1f2a3b4c";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("whatsappTemplateSchema", () => {
  it("accepts an approved template with params", () => {
    expect(
      whatsappTemplateSchema.parse({ name: " course_offer_v2 ", language: "en_US", bodyParams: ["{{first_name}}"] })
    ).toEqual({ name: "course_offer_v2", language: "en_US", bodyParams: ["{{first_name}}"] });
  });

  it("accepts raw components", () => {
    expect(whatsappTemplateSchema.safeParse({ name: "t", language: "en", components: [{ type: "body" }] }).success).toBe(true);
  });

  it.each([
    [{ name: "", language: "en" }],
    [{ name: "Course Offer", language: "en" }],
    [{ name: "course-offer", language: "en" }],
    [{ name: "course_offer", language: "e" }],
    [{ name: "course_offer" }],
    [{ name: "course_offer", language: "en", bodyParams: Array(21).fill("x") }],
    [{ name: "course_offer", language: "en", bodyParams: ["x".repeat(1001)] }],
    [{ name: "course_offer", language: "en", extra: 1 }],
  ])("rejects %j", (input) => {
    expect(whatsappTemplateSchema.safeParse(input).success).toBe(false);
  });
});

describe("templateVariables", () => {
  it("cleans lead fields and derives first name and city", () => {
    expect(
      templateVariables({
        name: "  Asha  Rao ",
        title: "Student",
        company: null,
        email: "Not available",
        phone: " 98450 12345 ",
        location: "Mysuru",
        course_interest: "NEET",
      })
    ).toEqual({
      name: "Asha  Rao",
      first_name: "Asha",
      title: "Student",
      company: "",
      email: "",
      phone: "98450 12345",
      location: "Mysuru",
      city: "Mysuru",
      course: "NEET",
    });
  });

  it("returns empty strings for an empty lead", () => {
    const vars = templateVariables({});
    expect(Object.values(vars).every((v) => v === "")).toBe(true);
    expect(vars.first_name).toBe("");
  });
});

describe("renderTemplate", () => {
  const vars = templateVariables({ name: "Asha Rao", company: "", course_interest: "NEET" });

  it("replaces variables case-insensitively with optional spaces", () => {
    expect(renderTemplate("Hi {{first_name}}, {{ NAME }} - {{Course}}", vars)).toBe("Hi Asha, Asha Rao - NEET");
  });

  it("uses the trimmed fallback when the value is empty or unknown", () => {
    expect(renderTemplate("Team: {{company| your team }}", vars)).toBe("Team: your team");
    expect(renderTemplate("{{nickname|friend}}", vars)).toBe("friend");
    expect(renderTemplate("{{first_name|friend}}", vars)).toBe("Asha");
  });

  it("renders unknown placeholders empty", () => {
    expect(renderTemplate("[{{unknown}}]", vars)).toBe("[]");
  });

  it("leaves numbered WhatsApp placeholders and plain text alone", () => {
    expect(renderTemplate("Hello {{1}} and { name }", vars)).toBe("Hello {{1}} and { name }");
  });
});

describe("buildEmailBodies", () => {
  const unsub = "https://api.example.com/api/webhooks/unsubscribe/tok";

  it("splits paragraphs, keeps line breaks and adds the footer", () => {
    const { html, text } = buildEmailBodies("\nHello Asha,\nWelcome!\n\n\nBye\n", unsub);
    expect(html).toContain('<p style="margin:0 0 14px">Hello Asha,<br>Welcome!</p><p style="margin:0 0 14px">Bye</p>');
    expect(html).toContain(`<a href="${unsub}" style="color:#888">Unsubscribe</a>`);
    expect(html.startsWith("<div")).toBe(true);
    expect(text).toBe(`Hello Asha,\nWelcome!\n\n\nBye\n\n--\nUnsubscribe: ${unsub}`);
  });

  it("escapes HTML", () => {
    const { html } = buildEmailBodies(`<script>alert("x")</script> & 'y'`, unsub);
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;");
    expect(html).not.toContain("<script>");
  });

  it("escapes the unsubscribe URL", () => {
    const { html } = buildEmailBodies("Hi", 'https://x.test/u?a=1&b="2"');
    expect(html).toContain('href="https://x.test/u?a=1&amp;b=&quot;2&quot;"');
  });

  it("links URLs without trailing punctuation", () => {
    const { html } = buildEmailBodies("See https://example.com/a?b=1&c=2. Or (https://example.org)!", unsub);
    expect(html).toContain('<a href="https://example.com/a?b=1&amp;c=2">https://example.com/a?b=1&amp;c=2</a>.');
    expect(html).toContain('(<a href="https://example.org">https://example.org</a>)!');
  });

  it("does not pull quotes or angle brackets into links", () => {
    const { html } = buildEmailBodies(`Open "https://example.com/x" or <https://example.org/y> or 'http://example.net'`, unsub);
    expect(html).toContain('&quot;<a href="https://example.com/x">https://example.com/x</a>&quot;');
    expect(html).toContain('&lt;<a href="https://example.org/y">https://example.org/y</a>&gt;');
    expect(html).toContain('&#39;<a href="http://example.net">http://example.net</a>&#39;');
  });
});

describe("buildWhatsAppTemplate", () => {
  const vars = templateVariables({ name: "Asha Rao", course_interest: "NEET" });

  it("builds body parameters, using '-' for empty values", () => {
    expect(
      buildWhatsAppTemplate({ name: "offer", language: "en", bodyParams: ["{{first_name}}", "{{company}}", "{{course}} 2027"] }, vars)
    ).toEqual({
      name: "offer",
      language: "en",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: "Asha" },
            { type: "text", text: "-" },
            { type: "text", text: "NEET 2027" },
          ],
        },
      ],
    });
  });

  it("renders raw components deeply and prefers them over bodyParams", () => {
    const result = buildWhatsAppTemplate(
      {
        name: "offer",
        language: "en",
        bodyParams: ["ignored"],
        components: [{ type: "header", parameters: [{ type: "text", text: "Hi {{first_name}}" }], index: 0, flag: true }],
      },
      vars
    );
    expect(result.components).toEqual([{ type: "header", parameters: [{ type: "text", text: "Hi Asha" }], index: 0, flag: true }]);
  });

  it("omits components when there are none", () => {
    expect(buildWhatsAppTemplate({ name: "hello_world", language: "en_US" }, vars)).toEqual({
      name: "hello_world",
      language: "en_US",
      components: undefined,
    });
    expect(buildWhatsAppTemplate({ name: "hello_world", language: "en_US", bodyParams: [], components: [] }, vars).components).toBeUndefined();
  });
});

describe("unsubscribe tokens", () => {
  beforeEach(() => {
    vi.stubEnv("CAMPAIGN_UNSUBSCRIBE_SECRET", "unit-test-secret");
  });

  it("round-trips a message id", () => {
    const token = unsubscribeToken(MESSAGE_ID);
    expect(token).toMatch(new RegExp(`^${MESSAGE_ID}\\.[A-Za-z0-9_-]{32}$`));
    expect(verifyUnsubscribeToken(token)).toBe(MESSAGE_ID);
  });

  it("is deterministic per secret", () => {
    const first = unsubscribeToken(MESSAGE_ID);
    expect(unsubscribeToken(MESSAGE_ID)).toBe(first);
    vi.stubEnv("CAMPAIGN_UNSUBSCRIBE_SECRET", "another-secret");
    expect(unsubscribeToken(MESSAGE_ID)).not.toBe(first);
    expect(verifyUnsubscribeToken(first)).toBeNull();
  });

  it("never falls back to the service role key", () => {
    vi.stubEnv("CAMPAIGN_UNSUBSCRIBE_SECRET", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    expect(unsubscribeConfigured()).toBe(false);
    expect(() => unsubscribeToken(MESSAGE_ID)).toThrow(/CAMPAIGN_UNSUBSCRIBE_SECRET/);
  });

  it("rejects tampered or malformed tokens", () => {
    const token = unsubscribeToken(MESSAGE_ID);
    const [, sig] = token.split(".");
    const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
    const otherId = "6b1f0c3a-2d4e-4f6a-8b7c-9d0e1f2a3b4c";
    expect(verifyUnsubscribeToken(`${MESSAGE_ID}.${flipped}`)).toBeNull();
    expect(verifyUnsubscribeToken(`${otherId}.${sig}`)).toBeNull();
    expect(verifyUnsubscribeToken(`${MESSAGE_ID}.${sig.slice(0, 10)}`)).toBeNull();
    expect(verifyUnsubscribeToken(MESSAGE_ID)).toBeNull();
    expect(verifyUnsubscribeToken("")).toBeNull();
    expect(verifyUnsubscribeToken(`not-a-uuid.${sig}`)).toBeNull();
    expect(verifyUnsubscribeToken(undefined as unknown as string)).toBeNull();
  });

  it("throws when signing without a secret and rejects every token", () => {
    const token = unsubscribeToken(MESSAGE_ID);
    vi.stubEnv("CAMPAIGN_UNSUBSCRIBE_SECRET", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(() => unsubscribeToken(MESSAGE_ID)).toThrow(/CAMPAIGN_UNSUBSCRIBE_SECRET/);
    expect(verifyUnsubscribeToken(token)).toBeNull();
  });

  it("builds the public unsubscribe URL", () => {
    vi.stubEnv("API_PUBLIC_URL", "https://api.example.com/");
    expect(unsubscribeUrl(MESSAGE_ID)).toBe(`https://api.example.com/api/webhooks/unsubscribe/${unsubscribeToken(MESSAGE_ID)}`);
  });
});

describe("publicApiUrl", () => {
  it("strips trailing slashes from API_PUBLIC_URL", () => {
    vi.stubEnv("API_PUBLIC_URL", "https://api.example.com///");
    expect(publicApiUrl()).toBe("https://api.example.com");
  });

  it("falls back to localhost and PORT", () => {
    vi.stubEnv("API_PUBLIC_URL", "");
    vi.stubEnv("PORT", "5050");
    expect(publicApiUrl()).toBe("http://localhost:5050");
    vi.stubEnv("PORT", "");
    expect(publicApiUrl()).toBe("http://localhost:4000");
  });
});

describe("isOptOutText", () => {
  it.each(["STOP", "stop", " Stop. ", "unsubscribe!", "opt out", "opt-out", "optout", "Cancel", "END", "quit!!"])(
    "treats %j as an opt-out",
    (text) => {
      expect(isOptOutText(text)).toBe(true);
    }
  );

  it.each(["please stop calling", "stop it", "don't stop", "Tell me more", "", null, undefined])("does not treat %j as an opt-out", (text) => {
    expect(isOptOutText(text)).toBe(false);
  });
});
