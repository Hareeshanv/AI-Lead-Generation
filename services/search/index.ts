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

/**
 * Extract the actual destination URL from a DuckDuckGo redirect link.
 */
function extractRealUrl(ddgUrl: string): string {
  if (ddgUrl.includes("uddg=")) {
    const parts = ddgUrl.split("uddg=");
    if (parts[1]) {
      return decodeURIComponent(parts[1].split("&")[0]);
    }
  }
  return ddgUrl;
}

/**
 * Parse a LinkedIn profile page title into structured parts.
 * LinkedIn titles follow these patterns:
 *   "Deepak K.S - Computer Science Student - RV University | LinkedIn"
 *   "Rakesh CS - Bengaluru, Karnataka, India | LinkedIn"
 *   "Yasasvini Reddy - Final Year Student at Target | LinkedIn"
 */
function parseLinkedInTitle(rawTitle: string): { name: string; title: string; company: string } {
  // First, remove the " | LinkedIn" suffix
  let cleaned = rawTitle.replace(/\s*\|\s*LinkedIn\s*$/i, "").trim();

  // Split by " - " (LinkedIn uses " - " as separator)
  const parts = cleaned.split(/\s+-\s+/);

  let name = parts[0]?.trim() || "";
  let title = "";
  let company = "";

  if (parts.length >= 3) {
    // Pattern: "Name - Title - Company"
    title = parts[1]?.trim() || "";
    company = parts.slice(2).join(" - ").trim();
  } else if (parts.length === 2) {
    const secondPart = parts[1]?.trim() || "";

    // Check if second part is a location (e.g., "Bengaluru, Karnataka, India")
    const isLocation = /^[A-Z][a-z]+,?\s+[A-Z]/i.test(secondPart) &&
      (secondPart.includes(",") || /\b(India|USA|UK|Canada|Australia|Germany|Singapore)\b/i.test(secondPart));

    if (isLocation) {
      // Pattern: "Name - Location" (no title or company)
      title = "";
      company = "";
    } else if (secondPart.toLowerCase().includes(" at ")) {
      // Pattern: "Name - Title at Company"
      const atParts = secondPart.split(/\s+at\s+/i);
      title = atParts[0]?.trim() || "";
      company = atParts.slice(1).join(" at ").trim();
    } else {
      // Pattern: "Name - Title" (no company)
      title = secondPart;
    }
  }

  // Clean up name — remove trailing location info
  name = name.replace(/,\s*[A-Z][a-z]+.*$/i, "").trim();

  return { name, title, company };
}

export class SearchProviderService {
  async discoverLeads(params: SearchQuery): Promise<DiscoveredLeadSearchResult[]> {
    let searchQuery = params.query;
    if (params.location) searchQuery += ` ${params.location}`;
    if (params.industry) searchQuery += ` ${params.industry}`;

    // Target LinkedIn profile pages for people searches
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
        const realUrl = extractRealUrl(rawUrl);

        // Skip results from job board domains entirely
        const resultDomain = extractDomain(rawUrl);
        const isJobBoardDomain = jobBoardDomains.some(jb => resultDomain.includes(jb));
        if (isJobBoardDomain) {
          continue;
        }

        // Detect profile type
        const isLinkedInProfile = realUrl.includes("linkedin.com/in/") || realUrl.includes("linkedin.com/pub/");
        const isGitHubProfile = realUrl.includes("github.com/") && !realUrl.includes("github.com/topics") && !realUrl.includes("github.com/search");

        let name = "";
        let title = "";
        let company = "";

        if (isLinkedInProfile) {
          // Use specialized LinkedIn title parser
          const parsed = parseLinkedInTitle(rawTitle);
          name = parsed.name;
          title = parsed.title;
          company = parsed.company;
        } else {
          // Generic title parsing for non-LinkedIn results
          const parts = rawTitle.split(/\s*[-–—|:]\s*/);
          name = parts[0]?.trim().replace(/\(.*?\)/g, "").replace(/,.*$/g, "").trim() || "";
          title = parts[1]?.trim() || "";
          company = parts[2]?.replace(/LinkedIn.*$/i, "").trim() || "";
        }

        // ── Filter out non-person results ──
        const startsWithNumber = /^\d/.test(name);
        const isArticleTitle = /^(how|why|what|where|when|which|can|do|does|should|is|are|the|a |an )/i.test(name);
        const hasJobKeywords = /\b(jobs?\s+in|internship|fresher|hiring|vacancy|vacanc|openings?|career|recruitment|apply|placement)\b/i.test(name);
        const isSingleWordLocation = /^[A-Z][a-z]+$/.test(name) && /^(bangalore|bengaluru|mumbai|delhi|chennai|hyderabad|pune|kolkata|india|usa|london)$/i.test(name);
        const isTooLong = name.length > 60;
        const hasNumericCount = /^\d+\+?\s/.test(name);

        const isDefinitelyNotPerson = startsWithNumber || isArticleTitle || hasJobKeywords || isSingleWordLocation || isTooLong || hasNumericCount;

        // Skip non-person results unless it's a confirmed profile URL
        const isPersonProfileUrl = isLinkedInProfile || isGitHubProfile;
        if (isDefinitelyNotPerson && !isPersonProfileUrl) {
          continue;
        }

        // Basic validity
        if (name.length <= 2) continue;

        // Clean up name
        name = name.replace(/\s*[-–—]\s*LinkedIn\s*$/i, "").trim();

        // Use real domain from the URL, but don't auto-generate fake domains from names
        let domain = "";
        if (rawUrl && !resultDomain.includes("linkedin.com") && !resultDomain.includes("duckduckgo.com") && !resultDomain.includes("github.com")) {
          domain = resultDomain;
        }

        // Determine the profile URL
        const profileUrl = isPersonProfileUrl ? realUrl : null;

        liveLeads.push({
          name,
          title: title || "",
          company: company || "",
          domain,
          snippet: rawSnippet.substring(0, 300),
          confidenceScore: isLinkedInProfile ? 90 : (isGitHubProfile ? 80 : 70),
          profileUrl,
        });
      }

      if (liveLeads.length > 0) {
        console.log(`[Search Service] Successfully extracted ${liveLeads.length} LIVE leads from web search.`);
        return liveLeads.slice(0, params.limit || 10);
      }
    } catch (err: any) {
      console.warn(`[Search Service] Live search fallback: ${err?.message}`);
    }

    // Empty array fallback — no fabricated leads
    console.log("[Search Service] No live leads found from web search.");
    return [];
  }
}

export const searchService = new SearchProviderService();
