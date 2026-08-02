import { aiService } from "./index";

export interface RawSearchLead {
  name: string;
  title: string;
  company: string;
  snippet: string;
  profileUrl: string | null;
  domain: string;
}

export interface EnrichedLead {
  name: string;
  title: string | null;
  company: string | null;
  location: string | null;
  industry: string | null;
  skills: string[] | null;
  profileUrl: string | null;
  estimatedEmail: string | null;
  emailConfidence: "high" | "medium" | "low" | null;
}

/**
 * Uses OpenAI GPT-4o-mini to enrich raw search results into structured lead data.
 * Only extracts information that can be verified from the search text.
 * Returns null for unknown fields — NEVER fabricates data.
 */
export async function enrichLeadsWithAI(
  rawLeads: RawSearchLead[],
  queryContext: string
): Promise<EnrichedLead[]> {
  if (rawLeads.length === 0) return [];

  // Build a compact representation of all leads for the prompt
  const leadsText = rawLeads
    .map(
      (lead, i) =>
        `[${i + 1}] Name: "${lead.name}" | Title: "${lead.title}" | Company: "${lead.company}" | Profile: ${lead.profileUrl || "N/A"} | Snippet: "${lead.snippet}"`
    )
    .join("\n");

  const systemPrompt = `You are a data extraction assistant. You extract structured lead/person data from search results. Rules:
- Only include data you can VERIFY from the provided search text.
- Use null for any field you cannot determine from the data.
- NEVER fabricate or guess email addresses, phone numbers, or company names.
- If the "company" field looks auto-generated (e.g. "Rakoshcs", "Priyadarshancs"), extract the real company/institution from the title or snippet instead.
- For students, set "company" to their university/institution name.
- Return valid JSON array only, no markdown.`;

  const userPrompt = `The user searched for: "${queryContext}"

Here are the raw search results:
${leadsText}

Extract structured data for each person. Return a JSON array with objects containing:
- "index": the number from the search result
- "name": cleaned full name (remove suffixes like "CS", fix capitalization)
- "title": their actual job title or role (e.g. "Computer Science Student", "Software Engineer", "Final Year Student")
- "company": their actual company or university (e.g. "RV University", "TCS", "VIT Bengaluru"). If they are a student, use their university.
- "location": their city/location if mentioned (e.g. "Bengaluru, India")
- "industry": classify their industry (e.g. "Education / Student", "Information Technology", "Software Development")
- "skills": array of skills if mentioned in snippet, otherwise null
- "estimated_email": ONLY if you can derive from a pattern like firstname.lastname@companydomain.com AND you know the real company domain. Otherwise null.
- "email_confidence": "low" if estimated, null if no email

Return ONLY valid JSON array, no explanation.`;

  try {
    const response = await aiService.generateText({
      prompt: userPrompt,
      systemPrompt,
      model: "gpt-4o-mini",
      temperature: 0.1,
      maxTokens: 2000,
    });

    // Parse the JSON response
    let enriched: any[];
    try {
      // Strip potential markdown code fences
      let jsonText = response.text.trim();
      if (jsonText.startsWith("```")) {
        jsonText = jsonText.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      }
      enriched = JSON.parse(jsonText);
    } catch (parseErr) {
      console.warn("[EnrichLeads] Failed to parse OpenAI response as JSON:", parseErr);
      console.warn("[EnrichLeads] Raw response:", response.text.substring(0, 500));
      // Fall back to basic enrichment from raw data
      return rawLeads.map((lead) => basicEnrich(lead, queryContext));
    }

    if (!Array.isArray(enriched)) {
      console.warn("[EnrichLeads] OpenAI response is not an array, using basic enrichment");
      return rawLeads.map((lead) => basicEnrich(lead, queryContext));
    }

    // Map enriched data back to raw leads
    return rawLeads.map((rawLead, idx) => {
      const match = enriched.find((e: any) => e.index === idx + 1) || enriched[idx];

      if (!match) {
        return basicEnrich(rawLead, queryContext);
      }

      return {
        name: match.name || rawLead.name,
        title: match.title || rawLead.title || null,
        company: match.company || null,
        location: match.location || extractLocationFromQuery(queryContext),
        industry: match.industry || inferIndustryFromQuery(queryContext),
        skills: Array.isArray(match.skills) ? match.skills : null,
        profileUrl: rawLead.profileUrl,
        estimatedEmail: match.estimated_email || null,
        emailConfidence: match.email_confidence || null,
      };
    });
  } catch (err: any) {
    console.warn("[EnrichLeads] OpenAI enrichment failed:", err?.message);
    // Fall back to basic enrichment
    return rawLeads.map((lead) => basicEnrich(lead, queryContext));
  }
}

/**
 * Basic enrichment without AI — extracts what we can from the raw data.
 * Used as a fallback when OpenAI is unavailable.
 */
function basicEnrich(lead: RawSearchLead, queryContext: string): EnrichedLead {
  // Try to extract real company from title if it contains "at" or "from"
  let company = lead.company;
  if (
    !company ||
    company === "Independent" ||
    company.toLowerCase() === lead.name.toLowerCase().replace(/[^a-z]/g, "")
  ) {
    // Company was auto-generated from name — try to extract from title
    const atMatch = lead.title.match(/(?:at|@)\s+(.+)/i);
    if (atMatch) {
      company = atMatch[1].trim();
    } else {
      company = null as any;
    }
  }

  return {
    name: lead.name,
    title: lead.title !== "Professional" ? lead.title : null,
    company: company || null,
    location: extractLocationFromQuery(queryContext),
    industry: inferIndustryFromQuery(queryContext),
    skills: null,
    profileUrl: lead.profileUrl,
    estimatedEmail: null,
    emailConfidence: null,
  };
}

/**
 * Extract location from the user's search query.
 */
function extractLocationFromQuery(query: string): string | null {
  const locations: Record<string, string> = {
    bengaluru: "Bengaluru, India",
    bangalore: "Bengaluru, India",
    mumbai: "Mumbai, India",
    delhi: "Delhi, India",
    "new delhi": "New Delhi, India",
    chennai: "Chennai, India",
    hyderabad: "Hyderabad, India",
    pune: "Pune, India",
    kolkata: "Kolkata, India",
    india: "India",
    "san francisco": "San Francisco, CA",
    "new york": "New York, NY",
    london: "London, UK",
    singapore: "Singapore",
    dubai: "Dubai, UAE",
    toronto: "Toronto, Canada",
    berlin: "Berlin, Germany",
  };

  const lowerQuery = query.toLowerCase();
  for (const [key, value] of Object.entries(locations)) {
    if (lowerQuery.includes(key)) {
      return value;
    }
  }
  return null;
}

/**
 * Infer industry from the search query context.
 */
function inferIndustryFromQuery(query: string): string {
  const lowerQuery = query.toLowerCase();

  if (lowerQuery.includes("student") || lowerQuery.includes("graduate") || lowerQuery.includes("university") || lowerQuery.includes("college")) {
    return "Education / Student";
  }
  if (lowerQuery.includes("fintech") || lowerQuery.includes("financial") || lowerQuery.includes("banking")) {
    return "Fintech & Financial Services";
  }
  if (lowerQuery.includes("saas") || lowerQuery.includes("software")) {
    return "SaaS & Software";
  }
  if (lowerQuery.includes("ai") || lowerQuery.includes("machine learning") || lowerQuery.includes("data science")) {
    return "AI & Machine Learning";
  }
  if (lowerQuery.includes("healthcare") || lowerQuery.includes("medical") || lowerQuery.includes("health")) {
    return "Healthcare";
  }
  if (lowerQuery.includes("ecommerce") || lowerQuery.includes("e-commerce") || lowerQuery.includes("retail")) {
    return "E-Commerce & Retail";
  }
  if (lowerQuery.includes("cs ") || lowerQuery.includes("computer science") || lowerQuery.includes("developer") || lowerQuery.includes("engineer")) {
    return "Computer Science / Technology";
  }
  if (lowerQuery.includes("hire") || lowerQuery.includes("talent") || lowerQuery.includes("recruit")) {
    return "Talent Acquisition";
  }

  return "Technology";
}
