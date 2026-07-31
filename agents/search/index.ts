import { searchService } from "../../services/search";

export class SearchAgent {
  async run(query: string, industry?: string) {
    const results = await searchService.discoverLeads({ query, industry });
    return results.map((res) => ({
      name: res.name,
      title: res.title,
      company: res.company,
      domain: res.domain,
      email: `${res.name.toLowerCase().replace(/[^a-z]/g, "")}@${res.domain}`,
    }));
  }
}

export const searchAgent = new SearchAgent();
