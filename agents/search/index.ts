import { searchService } from "../../services/search";
import { agentGateway } from "../../services/sarvam/agentGateway";

export class SearchAgent {
  async run(query: string, industry?: string) {
    // Prefer Sarvam AI agent if configured
    if (agentGateway.isConfigured("agt-search")) {
      const response = await agentGateway.runAgent("agt-search", { query, industry });
      if (response && response.success && response.output) {
        const leads = response.output.leads_discovered || response.output.leads || [];
        // If Sarvam returned an empty leads array (e.g. simulated response), skip and use fallback
        if (leads.length === 0) {
          console.log("[SearchAgent] Sarvam returned 0 leads, falling back to local search.");
        } else {
          return leads.map((res: any) => ({
            name: res.name || res.full_name || "Unknown",
            title: res.title || res.job_title || "Executive",
            company: res.company || res.company_name || "Unknown",
            domain: res.domain || res.company_domain || "",
            email: res.email || res.verified_email || res.estimated_email || `${(res.name || "user").toLowerCase().replace(/[^a-z]/g, "")}@${res.domain || "example.com"}`,
            // Preserve rich fields from Sarvam for pipeline use
            phone_number: res.phone_number || res.phone || null,
            profile_url: res.profile_url || null,
            source_channel: res.source_channel || "Sarvam AI",
            relevance_score: res.relevance_score || null,
            skills: res.skills || null,
            graduation: res.graduation || null,
            intent_level: res.intent_level || null,
            current_internship: res.current_internship || null,
            industry: res.industry || null,
            email_confidence: res.email_confidence || null,
            phone_confidence: res.phone_confidence || null,
            verified_email: res.verified_email || null,
            estimated_email: res.estimated_email || null,
            verified_email_source: res.verified_email_source || null,
            estimated_email_source: res.estimated_email_source || null,
            phone_source: res.phone_source || null,
            profile_url_source: res.profile_url_source || null,
            industry_source: res.industry_source || null,
          }));
        }
      }
    }

    // Fallback: Local stub
    const results = await searchService.discoverLeads({ query, industry });
    return results.map((res) => {
      const isCorporate = res.name.endsWith("Contact");
      const emailPrefix = isCorporate ? "info" : res.name.toLowerCase().replace(/[^a-z]/g, "");
      return {
        name: res.name,
        title: res.title,
        company: res.company,
        domain: res.domain,
        email: `${emailPrefix}@${res.domain}`,
      };
    });
  }
}

export const searchAgent = new SearchAgent();
