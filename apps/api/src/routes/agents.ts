import { Router } from "express";
import { orchestrator } from "../../../../agents/orchestrator";
import { dbQueries } from "@ai-lead-gen/database";

export const agentsRouter = Router();

// POST /api/agents/run
agentsRouter.post("/run", async (req, res) => {
  try {
    const { query = "Fintech Engineering Executives", industry = "Fintech & Payments" } = req.body;
    const result = await orchestrator.runLeadGenerationPipeline({ query, industry });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || "Agent execution failed" });
  }
});

// GET /api/agents/:id
agentsRouter.get("/:id", async (req, res) => {
  try {
    const agent = await dbQueries.getAgentStatus(req.params.id);
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }
    res.json({ success: true, agent });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});
