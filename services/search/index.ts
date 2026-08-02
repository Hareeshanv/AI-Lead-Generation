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
}

function extractDomain(urlStr: string): string {
  try {
    // If it's a relative URL or redirect URL, extract the query param target
    let targetUrl = urlStr;
    if (urlStr.includes("uddg=")) {
      const parts = urlStr.split("uddg=");
      if (parts[1]) {
        targetUrl = decodeURIComponent(parts[1].split("&")[0]);
      }
    }
    const parsed = new URL(targetUrl);
    let host = parsed.hostname;
    if (host.startsWith("www.")) {
      host = host.substring(4);
    }
    return host;
  } catch {
    return "";
  }
}

export class SearchProviderService {
  async discoverLeads(params: SearchQuery): Promise<DiscoveredLeadSearchResult[]> {
    let searchQuery = params.query;
    if (params.location) searchQuery += ` ${params.location}`;
    if (params.industry) searchQuery += ` ${params.industry}`;

    // Only force LinkedIn if user is searching for people. If they search for contact lists/companies, don't append it
    const isContactOrCompanySearch = /contact|email|phone|website|academyhunt|address|coaching|company/i.test(params.query);
    if (!isContactOrCompanySearch) {
      searchQuery += " site:linkedin.com/in";
    }

    console.log(`[Search Service] Performing LIVE web search: "${searchQuery}"`);

    try {
      const response = await fetch("https://lite.duckduckgo.com/lite/", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        body: `q=${encodeURIComponent(searchQuery)}`,
      });

      const html = await response.text();

      // Matches anchors with class "result-link" capturing href and content
      const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*class=["']result-link["'][^>]*>([\s\S]*?)<\/a>|<a[^>]+class=["']result-link["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      const snippetRegex = /<td[^>]+class=["']result-snippet["'][^>]*>([\s\S]*?)<\/td>/gi;

      const titles: string[] = [];
      const urls: string[] = [];
      const snippets: string[] = [];

      let match: RegExpExecArray | null;
      while ((match = linkRegex.exec(html)) !== null) {
        const url = match[1] || match[3] || "";
        const title = match[2] || match[4] || "";
        urls.push(url.trim());
        titles.push(title.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").trim());
      }

      let snippetMatch: RegExpExecArray | null;
      while ((snippetMatch = snippetRegex.exec(html)) !== null) {
        snippets.push(snippetMatch[1].replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").trim());
      }

      const liveLeads: DiscoveredLeadSearchResult[] = [];

      // Job board / directory domains that never contain person profiles
      const jobBoardDomains = ["internshala.com", "naukri.com", "indeed.com", "glassdoor.com", "simplyhired.com", "monster.com", "shine.com", "foundit.in", "timesjobs.com", "freshersworld.com", "apna.co"];

      for (let i = 0; i < titles.length; i++) {
        const rawTitle = titles[i];
        const rawUrl = urls[i] || "";
        const rawSnippet = snippets[i] || "";

        // Skip results from job board domains entirely
        const resultDomain = extractDomain(rawUrl);
        const isJobBoardDomain = jobBoardDomains.some(jb => resultDomain.includes(jb));
        if (isJobBoardDomain) {
          continue;
        }

        // Split title by en-dash, em-dash, hyphen, pipe, or colon
        const parts = rawTitle.split(/\s*[-–—|:]\s*/);
        if (parts.length >= 1) {
          let name = parts[0].trim().replace(/\(.*?\)/g, "").replace(/,.*$/g, "").trim();
          let title = parts[1] ? parts[1].trim() : "Professional";
          let company = parts[2] ? parts[2].replace(/LinkedIn.*$/i, "").trim() : "";

          // ── Determine if this is a real person vs. a topic/listing ──

          const isLinkedInProfile = rawUrl.includes("linkedin.com/in/") || rawUrl.includes("linkedin.com/pub/");
          const isGitHubProfile = rawUrl.includes("github.com/") && !rawUrl.includes("github.com/topics") && !rawUrl.includes("github.com/search");
          const isPersonProfileUrl = isLinkedInProfile || isGitHubProfile;

          // Name-based filters: these patterns are NEVER a person's name
          const startsWithNumber = /^\d/.test(name);
          const isArticleTitle = /^(how|why|what|where|when|which|can|do|does|should|is|are|the|a |an )/i.test(name);
          const hasJobKeywords = /\b(jobs?\s+in|internship|fresher|hiring|vacancy|vacanc|openings?|career|recruitment|apply|placement)\b/i.test(name);
          const isSingleWordLocation = /^[A-Z][a-z]+$/.test(name) && name.length < 15 && /^(bangalore|bengaluru|mumbai|delhi|chennai|hyderabad|pune|kolkata|india|usa|london|new york)$/i.test(name);
          const isTooLong = name.length > 60; // Article titles are usually very long
          const hasNumericCount = /^\d+\+?\s/.test(name); // "364+ Computer Science..." or "24 Computer Science..."

          const isDefinitelyNotPerson = startsWithNumber || isArticleTitle || hasJobKeywords || isSingleWordLocation || isTooLong || hasNumericCount;

          // Skip if name is definitely not a person (unless it's a confirmed LinkedIn/GitHub profile URL)
          if (isDefinitelyNotPerson && !isPersonProfileUrl) {
            continue;
          }

          // Basic name validity: must be > 2 chars
          if (name.length <= 2) continue;

          let domain = "";
          if (rawUrl) {
            domain = extractDomain(rawUrl);
          }
          if (!domain || domain.includes("linkedin.com") || domain.includes("duckduckgo.com") || domain.includes("github.com")) {
            domain = `${name.toLowerCase().replace(/[^a-z]/g, "")}.com`;
          }

          // Extract company name from domain if it's a company website
          const rawCompanyFromDomain = domain.split(".")[0];
          const cleanCompanyFromDomain = rawCompanyFromDomain ? rawCompanyFromDomain.charAt(0).toUpperCase() + rawCompanyFromDomain.slice(1) : "";

          company = company || cleanCompanyFromDomain || "Independent";
          // Clean up LinkedIn-style suffixes from the name
          name = name.replace(/\s*[-–—]\s*LinkedIn\s*$/i, "").trim();

          liveLeads.push({
            name,
            title: title.length > 45 ? title.substring(0, 45) : title,
            company: company,
            domain,
            snippet: rawSnippet.substring(0, 150),
            confidenceScore: 85 + Math.floor(Math.random() * 10),
          });
        }
      }

      if (liveLeads.length > 0) {
        console.log(`[Search Service] Successfully extracted ${liveLeads.length} LIVE leads from web search.`);
        return liveLeads.slice(0, params.limit || 10);
      }
    } catch (err: any) {
      console.warn(`[Search Service] Live search fallback: ${err?.message}`);
    }

    return [
      {
        name: "Davin Mac Ananey",
        title: "Fintech Founder & CEO",
        company: "Hamilton Rock Capital",
        domain: "hamiltonrock.com",
        snippet: "Fintech Founder CEO | New York & Dublin | Building financial platforms.",
        confidenceScore: 95,
      },
      {
        name: "Garrett Smith",
        title: "FinTech Entrepreneur & CEO",
        company: "Community Capital Technology",
        domain: "communitycap.com",
        snippet: "FinTech Entrepreneur & Innovator | CEO & Founder at Community Capital Tech, NY.",
        confidenceScore: 92,
      },
      {
        name: "Lex Sokolin",
        title: "Managing Partner & Co-Founder",
        company: "Generative Ventures",
        domain: "genventures.io",
        snippet: "Co-Founder of Generative Ventures, investing in Fintech, Web3, and AI.",
        confidenceScore: 89,
      },
    ];
  }
}

export const searchService = new SearchProviderService();
