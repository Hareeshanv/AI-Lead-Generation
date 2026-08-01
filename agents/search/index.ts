import { searchService } from "../../services/search";
import { agentGateway } from "../../services/sarvam/agentGateway";

export class SearchAgent {
  async run(query: string, industry?: string) {
    // Prefer Sarvam AI agent if configured
    if (agentGateway.isConfigured("agt-search")) {
      const response = await agentGateway.runAgent("agt-search", { query, industry });
      if (response && response.success && response.output) {
        const leads = response.output.leads_discovered || response.output.leads || [];
        return leads.map((res: any) => ({
          name: res.name || res.full_name || "Unknown",
          title: res.title || res.job_title || "Executive",
          company: res.company || res.company_name || "Unknown",
          domain: res.domain || res.company_domain || "",
          email: res.email || res.estimated_email || `${(res.name || "user").toLowerCase().replace(/[^a-z]/g, "")}@${res.domain || "example.com"}`,
        }));
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
