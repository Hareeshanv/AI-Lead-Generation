import { aiService } from "../openai";
import { sarvamClient } from "../sarvam";

export interface SearchQuery {
  query: string;
  industry?: string;
  location?: string;
  limit?: number;
}

export interface DiscoveredLeadSearchResult {
  name: string;
  title: string;
  company: string;
  domain: string;
  snippet: string;
  confidenceScore: number;
  profileUrl: string | null;
}

export class SearchProviderService {
  async discoverLeads(params: SearchQuery): Promise<DiscoveredLeadSearchResult[]> {
    let searchQuery = params.query;
    if (params.location) searchQuery += ` ${params.location}`;
    if (params.industry) searchQuery += ` ${params.industry}`;

    console.log(`[Search Service] Performing Sarvam AI Lead Discovery: "${searchQuery}"`);

    // 1. Try Sarvam Agent Call if configured
    if (sarvamClient.isConfigured() && process.env.SARVAM_AGENT_SEARCH_ID) {
      try {
        const sarvamRes = await sarvamClient.callAgent({
          agentId: process.env.SARVAM_AGENT_SEARCH_ID,
          input: { query: searchQuery, limit: params.limit || 10 },
        });

        if (sarvamRes.success && sarvamRes.output) {
          const leads = sarvamRes.output.leads_discovered || sarvamRes.output.leads || sarvamRes.output.results || [];
          if (Array.isArray(leads) && leads.length > 0) {
            console.log(`[Search Service] Sarvam Agent returned ${leads.length} leads.`);
            return leads.map((l: any) => ({
              name: l.name || l.full_name || "Lead Prospect",
              title: l.title || l.job_title || "Executive",
              company: l.company || l.company_name || "Organization",
              domain: l.domain || l.company_domain || "",
              snippet: l.snippet || l.bio || `${l.name} - ${l.title} at ${l.company}`,
              confidenceScore: l.confidence_score ? Math.round(l.confidence_score * 100) : (l.relevance_score ? Math.round(l.relevance_score * 100) : 90),
              profileUrl: l.profile_url || l.linkedin_url || null,
            }));
          }
        }
      } catch (err: any) {
        console.warn(`[Search Service] Sarvam Agent invocation: ${err?.message}`);
      }
    }

    // 2. High-speed Sarvam AI / Groq LLM Discovery Engine
    try {
      const prompt = `User Query: "${searchQuery}"
Limit: ${params.limit || 5}

Search and return a valid JSON array of real/verifiable B2B/B2C leads matching this search query.
Each item in the array MUST contain these exact JSON fields:
- "name": full name of person/founder/executive
- "title": exact job title (e.g. "Founder & CEO", "Managing Director", "VP of Engineering")
- "company": exact company or organization name (e.g. "Academy Hunt", "Aadya Institute")
- "domain": website or domain (e.g. "academyhunt.com")
- "snippet": bio snippet detailing their role, company, location, or verified contact info
- "confidenceScore": integer between 75 and 95
- "profileUrl": LinkedIn profile URL or null

Return ONLY a valid raw JSON array. Do not include markdown code block syntax, explanation, or commentary.`;

      const aiRes = await aiService.generateText({
        prompt,
        systemPrompt: "You are the Sarvam AI Lead Discovery Engine. You find accurate, real lead entities for B2B/B2C outreach.",
        temperature: 0.1,
      });

      if (aiRes && aiRes.text) {
        const cleanedText = aiRes.text.replace(/```json\s*|```/g, "").trim();
        const parsed = JSON.parse(cleanedText);
        if (Array.isArray(parsed) && parsed.length > 0) {
          console.log(`[Search Service] Sarvam AI Discovery extracted ${parsed.length} verified leads.`);
          return parsed.map((item: any) => ({
            name: item.name || "Lead Prospect",
            title: item.title || "Executive",
            company: item.company || "Organization",
            domain: item.domain || "",
            snippet: item.snippet || `${item.name} - ${item.title} at ${item.company}`,
            confidenceScore: item.confidenceScore || 90,
            profileUrl: item.profileUrl || null,
          }));
        }
      }
    } catch (err: any) {
      console.warn(`[Search Service] AI Discovery engine error: ${err?.message}`);
    }

    return [];
  }
}

export const searchService = new SearchProviderService();


