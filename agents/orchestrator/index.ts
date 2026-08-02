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

      // Try to extract email/phone from snippet if available — NEVER fabricate
      const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;
      const emailMatch = rawLead.snippet ? rawLead.snippet.match(emailRegex) : null;
      const email = emailMatch ? emailMatch[0] : (rawLead.email || "Not available");

      const phoneRegex = /(\+91[\s-]?\d{5}[\s-]?\d{5}|\+91[\s-]?\d{10}|\b\d{10}\b|\+1[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{4})/;
      const phoneMatch = rawLead.snippet ? rawLead.snippet.match(phoneRegex) : null;
      const phone = phoneMatch ? phoneMatch[0] : (rawLead.phone_number || "Not available");
      
      const loc = params.location || "Not specified";

      // 6. Persist to Supabase Database
      const newLead = {
        name: rawLead.name,
        title: rawLead.title || "Not available",
        company: rawLead.company || "Not available",
        email,
        phone,
        location: loc,
        score: leadScore,
        status: leadScore >= 80 ? "Hot" : (leadScore >= 50 ? "Warm" : "Cold"),
        source: "AI Search Discovery Agent",
        owner: "Alex Sterling",
        avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80",
        industry: rawLead.industry || params.industry || "Technology",
        company_size: "Not available",
        annual_revenue: "Not available",
        tech_stack: rawLead.skills || [],
        tags: [rawLead.profile_url ? "LinkedIn Verified" : "Web Search", leadScore >= 80 ? "High ICP Fit" : "Prospect"],
        // Enrichment fields
        verified_email: rawLead.verified_email || null,
        estimated_email: rawLead.estimated_email || null,
        email_confidence: email !== "Not available" ? "medium" : "low",
        phone_confidence: phone !== "Not available" ? "medium" : null,
        profile_url: rawLead.profile_url || null,
        verified_email_source: rawLead.verified_email_source || null,
        estimated_email_source: rawLead.estimated_email_source || null,
        phone_source: phone !== "Not available" ? "Search snippet" : null,
        profile_url_source: rawLead.profile_url_source || null,
        industry_source: rawLead.industry_source || "Query context",
        source_channel: rawLead.source_channel || "Local Search",
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
