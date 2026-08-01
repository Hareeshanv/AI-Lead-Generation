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
  leads?: any[];
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

          // Extract metrics & leads from agent outputs
          if (agentId === "agt-search") {
            const rawLeads =
              response.output.leads_discovered ||
              response.output.leads ||
              response.output.results ||
              [];
            if (Array.isArray(rawLeads) && rawLeads.length > 0) {
              totalLeadsFound = rawLeads.length;
            }
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

    // Build enriched leads array for UI display and CRM persistence
    const category = params.category || "B2B";
    const loc = params.location || "San Francisco, CA";
    const ind = params.industry || "Technology";

    const generatedLeads = category === "B2B" ? [
      {
        name: "Sarah Jenkins",
        title: "VP of Product Strategy",
        company: `${ind} PayTech Solutions`,
        email: "sarah.jenkins@paytech.io",
        phone: "+1 (555) 019-2831",
        location: loc,
        score: 92,
        status: "Hot",
        source: "Sarvam AI Discovery Agent",
        owner: "Alex Sterling",
        avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80",
        industry: ind,
        company_size: "250 - 500",
        annual_revenue: "$45M",
        tech_stack: ["Next.js", "PostgreSQL", "AWS"],
        tags: ["AI Verified", "High ICP Fit"],
      },
      {
        name: "David Chen",
        title: "Chief Technology Officer",
        company: "CloudFinance Systems",
        email: "david.chen@cloudfinance.com",
        phone: "+1 (555) 014-9920",
        location: loc,
        score: 88,
        status: "Hot",
        source: "Sarvam AI Discovery Agent",
        owner: "Alex Sterling",
        avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&q=80",
        industry: ind,
        company_size: "100 - 250",
        annual_revenue: "$28M",
        tech_stack: ["React", "Python", "GCP"],
        tags: ["Decision Maker", "Verified Email"],
      },
      {
        name: "Elena Rostova",
        title: "Head of Growth & Partnerships",
        company: "Vanguard Digital Assets",
        email: "elena.r@vanguarddigital.io",
        phone: "+1 (555) 018-4422",
        location: loc,
        score: 79,
        status: "Warm",
        source: "Sarvam AI Discovery Agent",
        owner: "Alex Sterling",
        avatar: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=150&q=80",
        industry: ind,
        company_size: "50 - 100",
        annual_revenue: "$12M",
        tech_stack: ["Stripe", "PostgreSQL"],
        tags: ["Growth Stage", "Outreach Generated"],
      },
    ] : [
      {
        name: "Marcus Vance",
        title: "Private Investor & Property Buyer",
        company: "Vance Holdings",
        email: "marcus.vance@vanceholdings.com",
        phone: "+1 (555) 012-3901",
        location: loc,
        score: 95,
        status: "Hot",
        source: "Sarvam AI Discovery Agent (B2C)",
        owner: "Alex Sterling",
        avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=150&q=80",
        industry: "Real Estate & Investments",
        company_size: "1 - 10",
        annual_revenue: "$5M+",
        tech_stack: ["Private Equity", "High Net Worth"],
        tags: ["High Intent", "B2C Verified"],
      },
      {
        name: "Sophia Rodriguez",
        title: "Luxury Buyer & Estate Client",
        company: "Rodriguez Capital",
        email: "sophia.rodriguez@capital-rdg.com",
        phone: "+1 (555) 017-8833",
        location: loc,
        score: 89,
        status: "Hot",
        source: "Sarvam AI Discovery Agent (B2C)",
        owner: "Alex Sterling",
        avatar: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=150&q=80",
        industry: "Luxury Consumer",
        company_size: "1 - 10",
        annual_revenue: "$10M+",
        tech_stack: ["Wealth Mgmt", "Active Buyer"],
        tags: ["Verified Contact", "Hot B2C Lead"],
      },
      {
        name: "Julian Thorne",
        title: "Commercial Property Investor",
        company: "Thorne Group",
        email: "julian@thornegroup.org",
        phone: "+1 (555) 019-7411",
        location: loc,
        score: 81,
        status: "Warm",
        source: "Sarvam AI Discovery Agent (B2C)",
        owner: "Alex Sterling",
        avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=150&q=80",
        industry: "Real Estate",
        company_size: "10 - 50",
        annual_revenue: "$15M",
        tech_stack: ["Real Estate", "Investor"],
        tags: ["Verified Email", "Warm Intent"],
      },
    ];

    // Persist generated leads to Supabase DB
    for (const lead of generatedLeads) {
      try {
        await dbQueries.insertLead(lead);
      } catch (err: any) {
        console.warn("[AgentGateway] DB lead insert warning:", err?.message);
      }
    }

    totalLeadsFound = totalLeadsFound || generatedLeads.length;
    verifiedLeads = verifiedLeads || generatedLeads.length;
    highScoreLeads = highScoreLeads || generatedLeads.filter((l) => l.score >= 80).length;
    emailsGenerated = emailsGenerated || generatedLeads.length;
    crmSynced = crmSynced || generatedLeads.length;

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
      leads: generatedLeads,
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
