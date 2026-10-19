/**
 * Sarvam AI Chat Completions Client
 *
 * Each local "agent" is a system prompt sent to Sarvam's OpenAI-compatible
 * chat completions endpoint (POST {base}/v1/chat/completions). The agent's
 * JSON input is sent as the user message and the model's reply is parsed as JSON.
 *
 * Uses native fetch (Node 18+) — no external dependencies required.
 */

export interface SarvamAgentRequest {
  agentId: string;
  input: Record<string, any>;
  sessionId?: string;
  metadata?: Record<string, any>;
  /** Per-attempt HTTP timeout; defaults to 60s. */
  timeoutMs?: number;
  /** Workspace credentials; each missing value falls back to the SARVAM_* env vars. */
  config?: SarvamConfig;
}

export interface SarvamConfig {
  apiKey?: string | null;
  baseUrl?: string | null;
  model?: string | null;
}

export interface SarvamAgentResponse {
  success: boolean;
  agentId: string;
  output: Record<string, any>;
  executionId: string;
  tokensUsed: number;
  durationMs: number;
  modelUsed: string;
  specificAnswer?: string;
  searchSummary?: string;
  error?: string;
}

export interface SarvamAgentStatusResponse {
  agentId: string;
  configured: boolean;
  model: string;
}

const QUERY_PARSER_PROMPT = `You are the Query Parser agent of a lead search system for Indian coaching institutes and training academies.
The user message is JSON {"query": "<free text>"} describing which EXISTING leads to show from our own database (for example "NEET students in Bengaluru" or "Java Bangalore").
Convert the query into search filters. Do NOT name, invent or look up any people, companies, phone numbers or emails.
Respond with ONLY a JSON object (no markdown, no commentary) with exactly these keys:
- "course_interest": course or exam the lead wants, using short canonical names such as "NEET", "JEE", "Java", "Python", "Full Stack", "Software Testing", "Data Science", "SAP"; or null
- "city": city name, preferring official spellings ("Bengaluru" not "Bangalore", "Mysuru" not "Mysore"); or null
- "exam_year": four-digit year such as "2027" if the query mentions one; or null
- "source_platform": "meta" for Facebook/Instagram/Meta ads, "google" for Google Ads; or null
- "status": "Hot", "Warm" or "Cold" if the query asks for that lead temperature; or null
- "min_score": minimum lead score 0-100 if the query asks for one; or null
- "keywords": array of other meaningful words from the query (lowercase, no filler words like "students", "in", "show"); may be empty
Use null for anything the query does not state. Never guess a city or year that is not in the query.`;

const DISCOVERY_PROMPT = `You are the Lead Discovery agent for an Indian business.
The user message is JSON {"query": string, "city": string, "city_aliases": string[], "results": [{"index": number, "platform": string, "url": string, "title": string, "snippet": string, "date": string|null}]}.
"query" is the product, service or course the business offers (any niche: coaching, dental care, interior design, software, etc.). Each result is a public web search hit (Reddit, Quora, LinkedIn, YouTube, Instagram, Facebook or another site). Judge each one ONLY from its title and snippet.
Keep only prospective customers: a person (or a parent/guardian on someone's behalf, or a small business owner) who wants this product/service, ideally in or near the city.
Set is_prospective_customer to false for: businesses, institutes, agencies, clinics, sellers or their staff promoting themselves; ads, listings, directories, blogs and review sites; recruiters and job postings; news articles; and posts unrelated to wanting the query.
Respond with ONLY a JSON object (no markdown, no commentary): {"results": [{"index": number, "is_prospective_customer": boolean, "author_handle": string|null, "interest": string|null, "location_match": "exact"|"nearby"|"state"|null, "intent_score": number, "urgency": "high"|"medium"|"low", "lead_routing_category": "hot"|"warm"|"nurture"|"guardian_consent_needed", "contact_requested": boolean, "is_minor": boolean, "suggested_public_reply": string|null}]}
Rules:
- Return one entry for every input index.
- author_handle: the public username or display name visible in the title or snippet (for example "u/rahul_k" or "Priya Sharma"); null if none is shown. Never invent one.
- interest: short name of what they want (for example "Java course", "root canal", "modular kitchen").
- location_match: "exact" if the post names the city or one of city_aliases, "nearby" if it names a nearby town or area of that city, "state" if it only names the state; null if no location is mentioned.
- intent_score 0-100: 80-100 deciding now (asking for prices, quotes, availability, which provider to pick, or asking to be contacted); 50-79 actively comparing options or asking for suggestions; 20-49 general curiosity; below 20 for anything else. urgency is "high" for 80+, "medium" for 50-79, "low" otherwise.
- contact_requested: true only if the author explicitly asks to be contacted (for example "call me", "DM me", "send details", "whatsapp me", "interested please contact").
- is_minor: true if the post suggests the learner is a minor (Class 11/12, 11th/12th, PU/PUC, "my son", "my daughter").
- lead_routing_category: "guardian_consent_needed" when is_minor is true (even if they asked to be contacted); otherwise "hot" for 80+, "warm" for 50-79, "nurture" below 50.
- suggested_public_reply: a short, genuinely helpful public reply (max 2 sentences) that answers their question. Do NOT name any business or brand, do NOT include links or websites, and NEVER ask for their phone number or email. null when is_prospective_customer is false.
- NEVER output phone numbers or email addresses in any field, even if they appear in the input.`;

const PLACE_SCORING_PROMPT = `You are the Business Lead Scoring agent of a B2B lead generation system in India.
The user message is JSON {"query": string, "city": string, "businesses": [{"index": number, "name": string, "category": string|null, "address": string|null, "rating": number|null, "rating_count": number|null, "has_website": boolean, "has_phone": boolean}]}.
"query" describes the kind of business the user wants as leads (for example "dental clinics" or "interior designers"). Each business is a public Google Maps listing.
Respond with ONLY a JSON object (no markdown, no commentary): {"results": [{"index": number, "is_relevant": boolean, "fit_score": number, "reason": string}]}
Rules:
- Return one entry for every input index.
- is_relevant: true only if the business is the kind of business described by the query and is located in or near the city.
- fit_score 0-100: how good a sales lead it is, based only on the provided fields: relevance to the query, location, reachability (has_website, has_phone) and how established it looks (rating and rating_count). Below 20 when not relevant.
- reason: max 140 characters, plain text.
- Never invent facts, contacts or websites that are not in the input.`;

export const AGENT_PROMPTS: Record<string, string> = {
  "agt-discovery": DISCOVERY_PROMPT,
  "agt-place-scoring": PLACE_SCORING_PROMPT,

  // Internal prompt (not shown as an agent): lead search query parsing.
  "agt-query-parser": QUERY_PARSER_PROMPT,
};

// Reasoning models (sarvam-105b) spend part of max_tokens on hidden reasoning before the answer.
const AGENT_MAX_TOKENS: Record<string, number> = {
  "agt-discovery": 7000,
  "agt-place-scoring": 5000,
  "agt-query-parser": 2500,
};

/** Remove <think>…</think> reasoning blocks and markdown code fences from a model reply. */
export function cleanModelText(raw: string): string {
  let text = raw || "";
  const lastThinkClose = text.lastIndexOf("</think>");
  if (lastThinkClose !== -1) {
    text = text.slice(lastThinkClose + "</think>".length);
  }
  text = text.replace(/<think>[\s\S]*$/i, "");
  text = text.replace(/```(?:json|JSON)?\s*/g, "").replace(/```/g, "");
  return text.trim();
}

/** Parse the first JSON object/array found in a model reply. Throws if none can be parsed. */
export function parseModelJson(raw: string): any {
  const text = cleanModelText(raw);
  if (!text) throw new Error("Sarvam returned an empty response");

  try {
    return JSON.parse(text);
  } catch {
    // fall through to substring extraction
  }

  const starts = [text.indexOf("{"), text.indexOf("[")].filter((i) => i !== -1);
  if (starts.length === 0) throw new Error("Sarvam response did not contain JSON");
  const start = Math.min(...starts);
  const closer = text[start] === "{" ? "}" : "]";
  const end = text.lastIndexOf(closer);
  if (end <= start) throw new Error("Sarvam response contained incomplete JSON");

  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (err: any) {
    throw new Error(`Could not parse Sarvam response as JSON: ${err?.message}`);
  }
}

export class SarvamClient {
  private get apiKey(): string {
    return (process.env.SARVAM_API_KEY || "").trim();
  }

  /** Base URL without trailing slash or trailing /v1 (older .env files used https://api.sarvam.ai/v1). */
  get baseURL(): string {
    const raw = (process.env.SARVAM_API_BASE_URL || "https://api.sarvam.ai").trim();
    return raw.replace(/\/+$/, "").replace(/\/v1$/i, "");
  }

  get model(): string {
    return (process.env.SARVAM_MODEL || "sarvam-105b-conversations").trim();
  }

  /** Check if the Sarvam API key is configured */
  isConfigured(): boolean {
    return this.apiKey.length > 5;
  }

  hasPrompt(agentId: string): boolean {
    return !!AGENT_PROMPTS[agentId];
  }

  /**
   * Invoke an agent: sends its system prompt plus the JSON input to Sarvam chat completions
   * and parses the reply as JSON. Never reports success for failed or unparseable calls.
   */
  async callAgent(request: SarvamAgentRequest): Promise<SarvamAgentResponse> {
    const startTime = Date.now();

    const apiKey = (request.config?.apiKey || this.apiKey).trim();
    const baseURL = request.config?.baseUrl
      ? request.config.baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/i, "")
      : this.baseURL;
    const model = (request.config?.model || this.model).trim();

    const fail = (error: string, modelUsed = model): SarvamAgentResponse => ({
      success: false,
      agentId: request.agentId,
      output: {},
      executionId: `err-${Date.now()}`,
      tokensUsed: 0,
      durationMs: Date.now() - startTime,
      modelUsed,
      error,
    });

    if (apiKey.length <= 5) {
      return fail("Sarvam API key is not configured");
    }

    const systemPrompt = AGENT_PROMPTS[request.agentId];
    if (!systemPrompt) {
      return fail(`No Sarvam prompt is defined for agent ${request.agentId}`);
    }

    const url = `${baseURL}/v1/chat/completions`;
    const body = JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(request.input) },
      ],
      temperature: 0.2,
      max_tokens: AGENT_MAX_TOKENS[request.agentId] || 1500,
    });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "api-subscription-key": apiKey,
    };

    const timeoutMs = request.timeoutMs ?? 60_000;
    let data: any;
    for (let attempt = 1; attempt <= 2; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(timeoutMs) });
      } catch (err: any) {
        const reason =
          err?.name === "TimeoutError" ? `timed out after ${Math.round(timeoutMs / 1000)}s` : err?.message || "network error";
        return fail(`Sarvam request failed: ${reason}`);
      }

      if (res.ok) {
        try {
          data = await res.json();
        } catch {
          return fail("Sarvam returned a non-JSON HTTP response");
        }
        break;
      }

      const errText = await res.text().catch(() => "");
      const retryable = res.status === 429 || res.status === 502 || res.status === 503;
      if (retryable && attempt === 1) {
        await this.sleep(2_000);
        continue;
      }
      return fail(`Sarvam API responded with HTTP ${res.status}: ${errText.slice(0, 300)}`);
    }

    const content: string = data?.choices?.[0]?.message?.content ?? "";
    const finishReason: string | undefined = data?.choices?.[0]?.finish_reason;
    const modelUsed: string = data?.model || model;
    const tokensUsed: number = data?.usage?.total_tokens || 0;

    if (finishReason === "length" && !cleanModelText(content)) {
      const failed = fail("Sarvam response was cut off (max_tokens reached) before any answer was produced", modelUsed);
      failed.tokensUsed = tokensUsed;
      return failed;
    }

    let parsed: any;
    try {
      parsed = parseModelJson(content);
    } catch (err: any) {
      const failed = fail(err?.message || "Could not parse Sarvam response", modelUsed);
      failed.tokensUsed = tokensUsed;
      failed.output = { raw: cleanModelText(content).slice(0, 2000) };
      return failed;
    }

    const output: Record<string, any> = Array.isArray(parsed) ? { leads: parsed } : parsed;
    const specificAnswer =
      typeof output.summary === "string"
        ? output.summary
        : typeof output.ideal_customer_profile === "string"
          ? output.ideal_customer_profile
          : undefined;

    return {
      success: true,
      agentId: request.agentId,
      output,
      executionId: data?.id || `exec-${Date.now()}`,
      tokensUsed,
      durationMs: Date.now() - startTime,
      modelUsed,
      specificAnswer,
      searchSummary: specificAnswer,
    };
  }

  /** Sarvam chat completions has no per-agent status endpoint; report local configuration only. */
  async getAgentStatus(agentId: string): Promise<SarvamAgentStatusResponse> {
    return {
      agentId,
      configured: this.isConfigured() && this.hasPrompt(agentId),
      model: this.model,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const sarvamClient = new SarvamClient();
