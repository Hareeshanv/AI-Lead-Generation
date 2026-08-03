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
 * Extract the actual destination URL from a redirect link.
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

    console.log(`[Search Service] Performing search exclusively via Sarvam AI Engine: "${searchQuery}"`);

    try {
      const response = await fetch("https://api.sarvam.ai/v1/agents/search/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.SARVAM_API_KEY || ""}`,
        },
        body: JSON.stringify({ query: searchQuery, limit: params.limit || 10 }),
      }).catch(() => null);

      if (response && response.ok) {
        const data: any = await response.json();
        if (data.results && data.results.length > 0) {
          return data.results.map((item: any) => ({
            name: item.name || "Unknown Lead",
            title: item.title || "Executive",
            company: item.company || "Unknown Company",
            domain: item.domain || "",
            snippet: item.snippet || "",
            confidenceScore: item.confidenceScore || 90,
            profileUrl: item.profileUrl || null,
          }));
        }
      }
    } catch (err: any) {
      console.warn(`[Search Service] Sarvam search: ${err?.message}`);
    }

    console.log("[Search Service] Sarvam AI Search completed.");
    return [];
  }
}

export const searchService = new SearchProviderService();

