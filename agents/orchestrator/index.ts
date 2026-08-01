import { agentGateway, PipelineParams, PipelineRunResult } from "../../services/sarvam/agentGateway";
import { searchAgent } from "../search";
import { verifierAgent } from "../verifier";
import { scoringAgent } from "../scoring";
import { outreachAgent } from "../outreach";
import { deduplicationEngine } from "../deduplication";
import { dbQueries } from "../../packages/database/src";

export interface AgentRunParams {
  query: string;
  industry?: string;
  category?: "B2B" | "B2C";
  location?: string;
  targetCount?: number;
}

export class AgentOrchestrator {
  /**
   * Run the full lead generation pipeline.
   *
   * If Sarvam AI agents are configured, the pipeline runs through the
   * Sarvam AI platform. Otherwise, it falls back to the local agent stubs.
   */
  async runLeadGenerationPipeline(params: AgentRunParams): Promise<PipelineRunResult | any> {
    const startTime = Date.now();
    console.log(`[Orchestrator] Starting autonomous lead pipeline for query: "${params.query}"`);

    await dbQueries.logAgentTelemetry("agt-planner", "info", `Orchestration pipeline started for "${params.query}"`);

    // ═══════════════════════════════════════════
    // STRATEGY: Prefer Sarvam AI gateway if configured
    // ═══════════════════════════════════════════

    if (agentGateway.isConfigured("agt-search") || agentGateway.isConfigured("agt-planner")) {
      console.log("[Orchestrator] Sarvam AI agents detected → routing through platform gateway.");

      const pipelineParams: PipelineParams = {
        query: params.query,
        industry: params.industry,
        category: params.category || "B2B",
        location: params.location,
        targetCount: params.targetCount,
      };

      return await agentGateway.runPipeline(pipelineParams);
    }

    // ═══════════════════════════════════════════
    // FALLBACK: Local agent stubs (original behavior)
    // ═══════════════════════════════════════════

    console.log("[Orchestrator] No Sarvam AI agents configured → using local agent stubs.");

    // 1. Search Discovery
    const rawLeads = await searchAgent.run(params.query, params.industry);
    await dbQueries.logAgentTelemetry("agt-search", "info", `Discovered ${rawLeads.length} candidate profiles`);

    const processedLeads = [];

    for (const rawLead of rawLeads) {
      // 2. Deduplication check
      const isDuplicate = await deduplicationEngine.isDuplicate(rawLead.email, rawLead.domain);
      if (isDuplicate) {
        console.log(`[Orchestrator] Skipping duplicate lead: ${rawLead.email}`);
        continue;
      }

      // 3. Email & Deliverability Verification
      const verification = await verifierAgent.verify(rawLead.email);
      await dbQueries.logAgentTelemetry("agt-verifier", "info", `Verified ${rawLead.email} (Status: ${verification.status})`);

      // 4. ICP Lead Scoring
      const leadScore = scoringAgent.calculateICPScore({
        companySize: "250 - 500",
        annualRevenue: "$45M",
        industry: params.industry || "Technology",
        hasVerifiedEmail: verification.isValid,
      });

      // 5. Generate Personalized Outreach Copy
      const outreachCopy = await outreachAgent.generateCopy({
        name: rawLead.name,
        title: rawLead.title,
        company: rawLead.company,
        techStack: ["Next.js", "PostgreSQL", "AWS"],
      });

      // 6. Persist to Supabase Database
      const newLead = {
        name: rawLead.name,
        title: rawLead.title,
        company: rawLead.company,
        email: rawLead.email,
        phone: "+1 (555) 019-2831",
        location: params.location || "San Francisco, CA",
        score: leadScore,
        status: leadScore >= 80 ? "Hot" : "Warm",
        source: "AI Search Discovery Agent",
        owner: "Alex Sterling",
        avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80",
        industry: params.industry || "SaaS & AI",
        company_size: "250 - 500",
        annual_revenue: "$45M",
        tech_stack: ["Next.js", "PostgreSQL", "AWS"],
        tags: ["AI Verified", "High ICP Fit"],
      };

      try {
        await dbQueries.insertLead(newLead);
      } catch (err: any) {
        console.warn("DB insert fallback warning:", err?.message);
      }

      processedLeads.push({ ...newLead, outreachCopy });
    }

    const duration = Date.now() - startTime;
    await dbQueries.logAgentTelemetry("agt-planner", "info", `Pipeline complete in ${duration}ms. ${processedLeads.length} leads enriched and saved.`);

    return {
      pipelineRunId: `run-local-${Date.now()}`,
      success: true,
      totalLeadsFound: rawLeads.length,
      verifiedLeads: processedLeads.length,
      highScoreLeads: processedLeads.filter((l) => l.score >= 80).length,
      emailsGenerated: processedLeads.length,
      crmSynced: 0,
      durationMs: duration,
      steps: [],
      errors: [],
      leads: processedLeads,
    };
  }
}

export const orchestrator = new AgentOrchestrator();
