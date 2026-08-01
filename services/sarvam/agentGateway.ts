import { sarvamClient, SarvamAgentResponse } from "./index";
import { dbQueries } from "../../packages/database/src";

/**
 * Agent Gateway — Maps internal agent IDs to Sarvam AI platform agent IDs
 * and provides the pipeline execution engine.
 */

// Internal agent ID → Sarvam AI platform agent ID (from environment variables)
const AGENT_MAP: Record<string, string | undefined> = {
  "agt-orchestrator": process.env.SARVAM_AGENT_ORCHESTRATOR_ID,
  "agt-planner": process.env.SARVAM_AGENT_PLANNER_ID,
  "agt-search": process.env.SARVAM_AGENT_SEARCH_ID,
  "agt-crawler": process.env.SARVAM_AGENT_CRAWLER_ID,
  "agt-extractor": process.env.SARVAM_AGENT_EXTRACTOR_ID,
  "agt-enrichment": process.env.SARVAM_AGENT_ENRICHMENT_ID,
  "agt-verifier": process.env.SARVAM_AGENT_VERIFIER_ID,
  "agt-deduplication": process.env.SARVAM_AGENT_DEDUPLICATION_ID,
  "agt-scoring": process.env.SARVAM_AGENT_SCORING_ID,
  "agt-outreach": process.env.SARVAM_AGENT_OUTREACH_ID,
  "agt-crm": process.env.SARVAM_AGENT_CRM_ID,
  "agt-report": process.env.SARVAM_AGENT_REPORT_ID,
  "agt-analytics": process.env.SARVAM_AGENT_ANALYTICS_ID,
  "agt-scheduler": process.env.SARVAM_AGENT_SCHEDULER_ID,
};

// Human-readable names for logging
const AGENT_NAMES: Record<string, string> = {
  "agt-orchestrator": "Master Orchestrator",
  "agt-planner": "Strategy Planner",
  "agt-search": "Search Discovery",
  "agt-crawler": "Web Crawler",
  "agt-extractor": "Data Extractor",
  "agt-enrichment": "Business Enrichment",
  "agt-verifier": "Email & Phone Verifier",
  "agt-deduplication": "Entity Deduplication",
  "agt-scoring": "ICP & Persona Scorer",
  "agt-outreach": "Outreach Copywriter",
  "agt-crm": "CRM Synchronization",
  "agt-report": "Report Generator",
  "agt-analytics": "Analytics & ROI Tracker",
  "agt-scheduler": "Task Scheduler",
};

// Pipeline execution order (Orchestrator calls these in sequence)
const PIPELINE_SEQUENCE = [
  "agt-planner",
  "agt-search",
  "agt-crawler",
  "agt-extractor",
  "agt-enrichment",
  "agt-verifier",
  "agt-deduplication",
  "agt-scoring",
  "agt-outreach",
  "agt-crm",
  "agt-report",
  "agt-analytics",
  "agt-scheduler",
];

export interface PipelineParams {
  query: string;
  industry?: string;
  category?: "B2B" | "B2C";
  location?: string;
  targetCount?: number;
}

export interface PipelineStepResult {
  agentId: string;
  agentName: string;
  status: "completed" | "failed" | "skipped";
  output: Record<string, any>;
  durationMs: number;
  tokensUsed: number;
  error?: string;
}

export interface PipelineRunResult {
  pipelineRunId: string;
  success: boolean;
  totalLeadsFound: number;
  verifiedLeads: number;
  highScoreLeads: number;
  emailsGenerated: number;
  crmSynced: number;
  durationMs: number;
  steps: PipelineStepResult[];
  errors: string[];
}

class AgentGateway {
  /**
   * Get the Sarvam platform agent ID for a local agent ID.
   */
  getSarvamAgentId(localAgentId: string): string | null {
    const envVarMap: Record<string, string | undefined> = {
      "agt-orchestrator": process.env.SARVAM_AGENT_ORCHESTRATOR_ID,
      "agt-planner": process.env.SARVAM_AGENT_PLANNER_ID,
      "agt-search": process.env.SARVAM_AGENT_SEARCH_ID,
      "agt-crawler": process.env.SARVAM_AGENT_CRAWLER_ID,
      "agt-extractor": process.env.SARVAM_AGENT_EXTRACTOR_ID,
      "agt-enrichment": process.env.SARVAM_AGENT_ENRICHMENT_ID,
      "agt-verifier": process.env.SARVAM_AGENT_VERIFIER_ID,
      "agt-deduplication": process.env.SARVAM_AGENT_DEDUPLICATION_ID,
      "agt-scoring": process.env.SARVAM_AGENT_SCORING_ID,
      "agt-outreach": process.env.SARVAM_AGENT_OUTREACH_ID,
      "agt-crm": process.env.SARVAM_AGENT_CRM_ID,
      "agt-report": process.env.SARVAM_AGENT_REPORT_ID,
      "agt-analytics": process.env.SARVAM_AGENT_ANALYTICS_ID,
      "agt-scheduler": process.env.SARVAM_AGENT_SCHEDULER_ID,
    };
    const val = envVarMap[localAgentId];
    return val && val.trim().length > 0 ? val.trim() : null;
  }

  /**
   * Check if a specific agent has a Sarvam AI platform ID configured.
   */
  isConfigured(localAgentId: string): boolean {
    const sarvamId = this.getSarvamAgentId(localAgentId);
    return !!sarvamId && sarvamClient.isConfigured();
  }

  /**
   * Get the human-readable name for an agent.
   */
  getAgentName(localAgentId: string): string {
    return AGENT_NAMES[localAgentId] || localAgentId;
  }

  /**
   * Get all agent IDs and their configuration status.
   */
  getAllAgents(): { id: string; name: string; configured: boolean; sarvamId: string | null }[] {
    return Object.keys(AGENT_NAMES).map((id) => ({
      id,
      name: AGENT_NAMES[id] || id,
      configured: this.isConfigured(id),
      sarvamId: this.getSarvamAgentId(id),
    }));
  }

  /**
   * Run a single agent via Sarvam AI platform.
   * Returns the agent's response or null if not configured.
   */
  async runAgent(
    localAgentId: string,
    input: Record<string, any>
  ): Promise<SarvamAgentResponse | null> {
    const sarvamId = this.getSarvamAgentId(localAgentId);

    if (!sarvamId || !sarvamClient.isConfigured()) {
      console.log(
        `[AgentGateway] Agent ${localAgentId} not configured on Sarvam AI. Falling back to local.`
      );
      return null;
    }

    console.log(
      `[AgentGateway] Invoking Sarvam AI agent: ${AGENT_NAMES[localAgentId]} (${sarvamId})`
    );

    const response = await sarvamClient.callAgent({
      agentId: sarvamId,
      input,
    });

    // Log telemetry to database
    try {
      await dbQueries.logAgentTelemetry(
        localAgentId,
        response.success ? "info" : "error",
        response.success
          ? `${AGENT_NAMES[localAgentId]} completed in ${response.durationMs}ms (${response.tokensUsed} tokens)`
          : `${AGENT_NAMES[localAgentId]} failed: ${response.error}`
      );
    } catch {
      // Don't let telemetry errors break the pipeline
    }

    return response;
  }

  /**
   * Run the full lead generation pipeline — executing all 13 agents in sequence.
   * (The orchestrator itself is not called as an agent — it IS this function.)
   */
  async runPipeline(params: PipelineParams): Promise<PipelineRunResult> {
    const pipelineStartTime = Date.now();
    const pipelineRunId = `run-${Date.now()}`;
    const steps: PipelineStepResult[] = [];
    const errors: string[] = [];

    // Metrics accumulators
    let totalLeadsFound = 0;
    let verifiedLeads = 0;
    let highScoreLeads = 0;
    let emailsGenerated = 0;
    let crmSynced = 0;

    // Create pipeline run in DB
    try {
      await dbQueries.createPipelineRun({
        id: pipelineRunId,
        campaign_name: `${params.category || "B2B"} - ${params.query}`,
        query: params.query,
        industry: params.industry || "Technology",
        category: params.category || "B2B",
        location: params.location || "Global",
        target_count: params.targetCount || 50,
        status: "running",
      });
    } catch (err: any) {
      console.warn("[AgentGateway] Could not create pipeline run in DB:", err?.message);
    }

    console.log(
      `\n${"=".repeat(60)}\n[Pipeline] Starting lead generation pipeline: "${params.query}"\n[Pipeline] Category: ${params.category || "B2B"} | Industry: ${params.industry || "All"} | Target: ${params.targetCount || 50}\n${"=".repeat(60)}\n`
    );

    // Build the initial input that flows through the pipeline
    let previousOutput: Record<string, any> = {
      query: params.query,
      industry: params.industry || "Technology",
      category: params.category || "B2B",
      location: params.location || "Global",
      target_count: params.targetCount || 50,
    };

    // Execute each agent in sequence
    for (const agentId of PIPELINE_SEQUENCE) {
      const agentName = AGENT_NAMES[agentId];
      const stepStartTime = Date.now();

      console.log(`[Pipeline] ▶ Running: ${agentName} (${agentId})`);

      try {
        const response = await this.runAgent(agentId, previousOutput);

        if (response && response.success) {
          const stepResult: PipelineStepResult = {
            agentId,
            agentName,
            status: "completed",
            output: response.output,
            durationMs: response.durationMs,
            tokensUsed: response.tokensUsed,
          };

          steps.push(stepResult);

          // Extract metrics from agent outputs
          if (agentId === "agt-search") {
            totalLeadsFound =
              response.output.total_discovered ||
              response.output.leads_discovered?.length ||
              totalLeadsFound;
          }
          if (agentId === "agt-verifier") {
            verifiedLeads =
              response.output.verified_count || response.output.total_verified || verifiedLeads;
          }
          if (agentId === "agt-scoring") {
            highScoreLeads =
              response.output.hot_leads || response.output.high_score_count || highScoreLeads;
          }
          if (agentId === "agt-outreach") {
            emailsGenerated =
              response.output.emails_generated || response.output.total_generated || emailsGenerated;
          }
          if (agentId === "agt-crm") {
            crmSynced =
              response.output.successfully_synced ||
              response.output.sync_results?.successfully_synced ||
              crmSynced;
          }

          // Pass this agent's output as the next agent's input
          previousOutput = {
            ...previousOutput,
            [`${agentId.replace("agt-", "")}_result`]: response.output,
          };

          console.log(
            `[Pipeline] ✓ ${agentName} completed in ${response.durationMs}ms`
          );
        } else if (response && !response.success) {
          // Agent ran but failed
          steps.push({
            agentId,
            agentName,
            status: "failed",
            output: {},
            durationMs: response.durationMs,
            tokensUsed: 0,
            error: response.error,
          });
          errors.push(`${agentName}: ${response.error}`);
          console.warn(`[Pipeline] ✗ ${agentName} failed: ${response.error}`);
        } else {
          // Agent not configured — skipped
          steps.push({
            agentId,
            agentName,
            status: "skipped",
            output: {},
            durationMs: Date.now() - stepStartTime,
            tokensUsed: 0,
          });
          console.log(`[Pipeline] ○ ${agentName} skipped (not configured on Sarvam AI)`);
        }

        // Log agent execution to DB
        try {
          await dbQueries.logAgentExecution({
            pipeline_run_id: pipelineRunId,
            agent_id: agentId,
            agent_name: agentName,
            status: steps[steps.length - 1].status,
            input: previousOutput,
            output: steps[steps.length - 1].output,
            error: steps[steps.length - 1].error || null,
            duration_ms: steps[steps.length - 1].durationMs,
            tokens_used: steps[steps.length - 1].tokensUsed,
          });
        } catch {
          // Don't let logging errors break the pipeline
        }
      } catch (err: any) {
        // Unexpected error — log and continue
        const errorMsg = `${agentName} threw unexpected error: ${err?.message}`;
        steps.push({
          agentId,
          agentName,
          status: "failed",
          output: {},
          durationMs: Date.now() - stepStartTime,
          tokensUsed: 0,
          error: errorMsg,
        });
        errors.push(errorMsg);
        console.error(`[Pipeline] ✗ ${errorMsg}`);
      }
    }

    const totalDuration = Date.now() - pipelineStartTime;

    const result: PipelineRunResult = {
      pipelineRunId,
      success: errors.length === 0,
      totalLeadsFound,
      verifiedLeads,
      highScoreLeads,
      emailsGenerated,
      crmSynced,
      durationMs: totalDuration,
      steps,
      errors,
    };

    // Update pipeline run in DB
    try {
      await dbQueries.updatePipelineRun(pipelineRunId, {
        status: errors.length === 0 ? "completed" : "completed_with_errors",
        total_leads_found: totalLeadsFound,
        verified_leads: verifiedLeads,
        high_score_leads: highScoreLeads,
        emails_generated: emailsGenerated,
        crm_synced: crmSynced,
        duration_ms: totalDuration,
        completed_at: new Date().toISOString(),
      });
    } catch (err: any) {
      console.warn("[AgentGateway] Could not update pipeline run in DB:", err?.message);
    }

    console.log(
      `\n${"=".repeat(60)}\n[Pipeline] COMPLETED in ${totalDuration}ms\n[Pipeline] Leads: ${totalLeadsFound} found → ${verifiedLeads} verified → ${highScoreLeads} hot\n[Pipeline] Errors: ${errors.length}\n${"=".repeat(60)}\n`
    );

    return result;
  }
}

export const agentGateway = new AgentGateway();
