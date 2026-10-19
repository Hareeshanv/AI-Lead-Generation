import { z } from "zod";
import { dbQueries } from "@ai-lead-gen/database";
import { cityAliases, canonicalCity, coursePatterns, sanitizeFilterValue } from "../../../../services/search/queryParser";
import { agentRunLimit, startDiscoveryRun, workspaceVocabulary } from "../agents/discovery";
import { createRouter } from "../http/router";
import { send } from "../http/pagination";
import { parse } from "../http/validate";
import { getCtx } from "../middleware/auth";
import { runDiscoverySchema } from "./agents";

/** Mounted at /api/discovery behind requireAuth(); owned by the AI Agents module. */
export const discoveryRouter = createRouter();

// POST /api/discovery/run — same as POST /api/agents/agt-discovery/runs; 202 {data: {id, status}}
discoveryRouter.post("/run", agentRunLimit, async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const run = await startDiscoveryRun(orgId, userId, parse(runDiscoverySchema, req.body));
  send(res, { id: run.id, status: run.status }, 202);
});

const resultsQuery = z.object({
  query: z.string().trim().max(200).optional(),
  location: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

// GET /api/discovery/results?query=&location=&limit= — saved intent signals, newest first
discoveryRouter.get("/results", async (req, res) => {
  const { orgId } = getCtx(req);
  const { query, location, limit } = parse(resultsQuery, req.query);
  const vocab = await workspaceVocabulary(orgId);
  const q = query ? sanitizeFilterValue(query) : "";
  const city = location ? canonicalCity(location, vocab) || sanitizeFilterValue(location) : "";
  const signals = await dbQueries.searchIntentSignals(orgId, {
    coursePatterns: q ? coursePatterns(q, vocab) : [],
    cityAliases: city ? cityAliases(city, vocab) : [],
    orderBy: "newest",
    limit,
  });
  send(res, signals);
});
