/**
 * Sarvam AI Platform API Client
 *
 * Communicates with the Sarvam AI agent platform to invoke agents,
 * check status, and retrieve results.
 *
 * Uses native fetch (Node 18+) — no external dependencies required.
 */

export interface SarvamAgentRequest {
  agentId: string;
  input: Record<string, any>;
  sessionId?: string;
  metadata?: Record<string, any>;
}

export interface SarvamAgentResponse {
  success: boolean;
  agentId: string;
  output: Record<string, any>;
  executionId: string;
  tokensUsed: number;
  durationMs: number;
  modelUsed: string;
  error?: string;
}

export interface SarvamAgentStatusResponse {
  agentId: string;
  name: string;
  status: "active" | "idle" | "error" | "deploying";
  lastInvokedAt: string | null;
  totalInvocations: number;
}

export class SarvamClient {
  private baseURL: string;
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.SARVAM_API_KEY || "";
    this.baseURL = process.env.SARVAM_API_BASE_URL || "https://api.sarvam.ai/v1";
  }

  /** Check if the Sarvam API key is configured */
  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.length > 5;
  }

  /**
   * Invoke a Sarvam AI agent with the given input.
   * Retries once on failure before giving up.
   */
  async callAgent(request: SarvamAgentRequest): Promise<SarvamAgentResponse> {
    if (!this.isConfigured()) {
      console.warn("[SarvamClient] SARVAM_API_KEY not configured. Returning simulated response.");
      return this.simulatedResponse(request.agentId, request.input);
    }

    const startTime = Date.now();
    const url = `${this.baseURL}/agents/${request.agentId}/invoke`;
    const body = JSON.stringify({
      input: request.input,
      session_id: request.sessionId,
      metadata: request.metadata,
    });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };

    try {
      const res = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(120_000) });

      if (!res.ok) {
        throw new Error(`Sarvam API responded with status ${res.status}`);
      }

      const data: any = await res.json();
      return {
        success: true,
        agentId: request.agentId,
        output: data.output || data.result || data,
        executionId: data.execution_id || data.id || `exec-${Date.now()}`,
        tokensUsed: data.tokens_used || data.usage?.total_tokens || 0,
        durationMs: Date.now() - startTime,
        modelUsed: data.model_used || data.model || "sarvam-agent",
      };
    } catch (primaryError: any) {
      console.warn(
        `[SarvamClient] Primary call to agent ${request.agentId} failed: ${primaryError?.message}. Retrying...`
      );

      // Retry once after 2 seconds
      await this.sleep(2000);

      try {
        const retryRes = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(120_000) });

        if (!retryRes.ok) {
          throw new Error(`Sarvam API retry responded with status ${retryRes.status}`);
        }

        const retryData: any = await retryRes.json();
        return {
          success: true,
          agentId: request.agentId,
          output: retryData.output || retryData.result || retryData,
          executionId: retryData.execution_id || retryData.id || `exec-retry-${Date.now()}`,
          tokensUsed: retryData.tokens_used || retryData.usage?.total_tokens || 0,
          durationMs: Date.now() - startTime,
          modelUsed: retryData.model_used || retryData.model || "sarvam-agent",
        };
      } catch (retryError: any) {
        console.error(
          `[SarvamClient] Retry also failed for agent ${request.agentId}: ${retryError?.message}`
        );

        return {
          success: false,
          agentId: request.agentId,
          output: {},
          executionId: `exec-failed-${Date.now()}`,
          tokensUsed: 0,
          durationMs: Date.now() - startTime,
          modelUsed: "none",
          error: retryError?.message || "Agent invocation failed after retry",
        };
      }
    }
  }

  /**
   * Check the status of a deployed Sarvam AI agent.
   */
  async getAgentStatus(agentId: string): Promise<SarvamAgentStatusResponse | null> {
    if (!this.isConfigured()) return null;

    try {
      const res = await fetch(`${this.baseURL}/agents/${agentId}/status`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) return null;

      const data: any = await res.json();
      return {
        agentId: data.id || agentId,
        name: data.name || agentId,
        status: data.status || "idle",
        lastInvokedAt: data.last_invoked_at || null,
        totalInvocations: data.total_invocations || 0,
      };
    } catch {
      return null;
    }
  }

  /**
   * Returns a simulated response when the API key is not configured.
   * This allows the app to work in development without a real Sarvam account.
   */
  private simulatedResponse(agentId: string, input: Record<string, any>): SarvamAgentResponse {
    return {
      success: true,
      agentId,
      output: {
        message: `[Simulated] Agent ${agentId} processed input successfully.`,
        query: input.query || input.prompt || "N/A",
        simulated: true,
      },
      executionId: `sim-${Date.now()}`,
      tokensUsed: 0,
      durationMs: 150,
      modelUsed: "simulated",
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const sarvamClient = new SarvamClient();
