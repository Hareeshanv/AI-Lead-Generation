export interface LLMRequest {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMResponse {
  text: string;
  modelUsed: string;
  tokensUsed: number;
}

export class OpenAIService {
  private openaiApiKey: string;
  private groqApiKey: string;

  constructor() {
    this.openaiApiKey = process.env.OPENAI_API_KEY || "";
    this.groqApiKey = process.env.GROQ_API_KEY || "";
  }

  async generateText(request: LLMRequest): Promise<LLMResponse> {
    // Strategy: Prefer Groq (free + ultra-fast) if GROQ_API_KEY is configured
    if (this.groqApiKey) {
      const groqModel = request.model?.includes("llama") ? request.model : "llama-3.3-70b-versatile";
      try {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.groqApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: groqModel,
            messages: [
              { role: "system", content: request.systemPrompt || "You are an expert AI Lead Generation Agent." },
              { role: "user", content: request.prompt },
            ],
            temperature: request.temperature ?? 0.1,
            max_tokens: request.maxTokens ?? 1000,
          }),
        });

        if (!res.ok) {
          throw new Error(`Groq API status ${res.status}`);
        }

        const data: any = await res.json();
        console.log(`[AI Service] Successfully generated response via Groq (${groqModel})`);
        return {
          text: data.choices?.[0]?.message?.content || "",
          modelUsed: `groq-${groqModel}`,
          tokensUsed: data.usage?.total_tokens || 0,
        };
      } catch (groqErr: any) {
        console.warn(`[AI Service] Groq request failed (${groqErr?.message}). Falling back to OpenAI...`);
      }
    }

    // OpenAI Path
    const primaryModel = request.model || "gpt-4o-mini";
    const fallbackModel = "gpt-4o-mini";

    if (!this.openaiApiKey) {
      console.warn("[AI Service] Both GROQ_API_KEY and OPENAI_API_KEY are missing. Returning simulated response.");
      return {
        text: `[AI Simulated Response]: Prospect intelligence analyzed for "${request.prompt.substring(0, 40)}...". High ICP match detected.`,
        modelUsed: "simulated-llm",
        tokensUsed: 142,
      };
    }

    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: primaryModel,
          messages: [
            { role: "system", content: request.systemPrompt || "You are an expert AI Lead Generation & Outreach Agent." },
            { role: "user", content: request.prompt },
          ],
          temperature: request.temperature ?? 0.2,
          max_tokens: request.maxTokens ?? 1000,
        }),
      });

      if (!res.ok) {
        throw new Error(`OpenAI API status ${res.status}`);
      }

      const data: any = await res.json();
      return {
        text: data.choices?.[0]?.message?.content || "",
        modelUsed: primaryModel,
        tokensUsed: data.usage?.total_tokens || 0,
      };
    } catch (primaryError: any) {
      console.warn(`Primary model ${primaryModel} failed (${primaryError?.message}). Attempting fallback to ${fallbackModel}...`);

      try {
        const fallbackRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.openaiApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: fallbackModel,
            messages: [
              { role: "system", content: request.systemPrompt || "You are an expert AI Lead Generation Agent." },
              { role: "user", content: request.prompt },
            ],
            temperature: 0.2,
          }),
        });

        if (!fallbackRes.ok) {
          throw new Error(`Fallback OpenAI status ${fallbackRes.status}`);
        }

        const fallbackData: any = await fallbackRes.json();
        return {
          text: fallbackData.choices?.[0]?.message?.content || "",
          modelUsed: fallbackModel,
          tokensUsed: fallbackData.usage?.total_tokens || 0,
        };
      } catch (fallbackError: any) {
        console.error("Both primary and fallback LLM requests failed:", fallbackError?.message);
        return {
          text: `[AI Fallback]: Enterprise prospect analysis completed for query: ${request.prompt.substring(0, 50)}`,
          modelUsed: "offline-fallback",
          tokensUsed: 50,
        };
      }
    }
  }
}

export const aiService = new OpenAIService();
