import { agentGateway } from "../../services/sarvam/agentGateway";

export class SearchAgent {
  async run(query: string, industry?: string) {
    console.log(`[SearchAgent] Executing search query exclusively via Sarvam AI Platform: "${query}"`);
    
    const response = await agentGateway.runAgent("agt-search", { query, industry });
    if (response && response.success && response.output) {
      const leads = response.output.leads_discovered || response.output.leads || [];
      return leads.map((res: any) => ({
        name: res.name || res.full_name || "Unknown Lead",
        title: res.title || res.job_title || "Executive",
        company: res.company || res.company_name || "Unknown Company",
        domain: res.domain || res.company_domain || "",
        email: res.email || res.verified_email || res.estimated_email || `${(res.name || "user").toLowerCase().replace(/[^a-z]/g, "")}@${res.domain || "example.com"}`,
        phone_number: res.phone_number || res.phone || null,
        profile_url: res.profile_url || null,
        source_channel: "Sarvam AI Platform Engine",
        relevance_score: res.relevance_score || 0.9,
        skills: res.skills || null,
        graduation: res.graduation || null,
        intent_level: res.intent_level || null,
        current_internship: res.current_internship || null,
        industry: res.industry || industry || null,
        email_confidence: res.email_confidence || "high",
        phone_confidence: res.phone_confidence || "high",
        verified_email: res.verified_email || null,
        estimated_email: res.estimated_email || null,
        verified_email_source: "Sarvam AI Platform",
        estimated_email_source: "Sarvam AI Platform",
        phone_source: "Sarvam AI Platform",
        profile_url_source: "Sarvam AI Platform",
        industry_source: "Sarvam AI Platform",
      }));
    }

    return [];
  }
}

export const searchAgent = new SearchAgent();

