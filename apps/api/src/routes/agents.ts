import { Router } from "express";
import { orchestrator } from "../../../../agents/orchestrator";
import { agentGateway } from "../../../../services/sarvam/agentGateway";
import { dbQueries } from "@ai-lead-gen/database";

export const agentsRouter = Router();

// ═══════════════════════════════════════════
// GET /api/agents — List all 14 agents with status
// ═══════════════════════════════════════════

agentsRouter.get("/", async (_req, res) => {
  try {
    // Try to fetch from database first
    const dbAgents = await dbQueries.getAllAgentStatuses();

    // Get gateway configuration status for each agent
    const gatewayAgents = agentGateway.getAllAgents();

    // Merge DB data with gateway configuration
    const agents = gatewayAgents.map((gAgent) => {
      const dbAgent = dbAgents.find((d: any) => d.id === gAgent.id);
      return {
        id: gAgent.id,
        name: dbAgent?.name || gAgent.name,
        type: dbAgent?.type || "AI Agent",
        status: gAgent.configured ? "active" : (dbAgent?.status || "idle"),
        description: dbAgent?.description || `${gAgent.name} agent`,
        sarvam_configured: gAgent.configured,
        sarvam_agent_id: gAgent.sarvamId,
        running_jobs: dbAgent?.running_jobs || 0,
        success_rate: dbAgent?.success_rate || 99.0,
        total_executions: dbAgent?.total_executions || 0,
        avg_latency: dbAgent?.avg_latency || "500ms",
        model: dbAgent?.model || "gpt-4o",
        temperature: dbAgent?.temperature || 0.2,
        concurrency: dbAgent?.concurrency || 10,
      };
    });

    res.json({ success: true, count: agents.length, agents });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || "Failed to fetch agents" });
  }
});

// ═══════════════════════════════════════════
// POST /api/agents/run — Run the full pipeline
// (MUST be before /:id routes to avoid matching "run" as an agent ID)
// ═══════════════════════════════════════════

agentsRouter.post("/run", async (req, res) => {
  try {
    let rawQuery = req.body.query || "Fintech Engineering Executives";
    let location = req.body.location || "";
    let category = req.body.category || "B2B";
    let targetCount = req.body.targetCount ? Number(req.body.targetCount) : 50;
    let industry = req.body.industry || "";

    // Parse formatted queries like "[B2B] Aadya institite founders in bengaluru (Target: 50 leads)"
    const categoryMatch = rawQuery.match(/^\[(B2B|B2C)\]\s*/i);
    if (categoryMatch) {
      category = categoryMatch[1].toUpperCase();
      rawQuery = rawQuery.replace(/^\[(B2B|B2C)\]\s*/i, "");
    }

    const volumeMatch = rawQuery.match(/\(Target:\s*(\d+)\s*leads\)/i);
    if (volumeMatch) {
      targetCount = parseInt(volumeMatch[1], 10);
      rawQuery = rawQuery.replace(/\(Target:\s*\d+\s*leads\)/i, "");
    }

    const inLocationMatch = rawQuery.match(/\s+in\s+([A-Za-z0-9\s,]+)$/i);
    if (inLocationMatch && !location) {
      location = inLocationMatch[1].trim();
      rawQuery = rawQuery.replace(/\s+in\s+[A-Za-z0-9\s,]+$/i, "");
    }

    let cleanQuery = rawQuery.trim();
    // Normalize common typos in queries (e.g. "instiyute" -> "institute")
    cleanQuery = cleanQuery
      .replace(/\binstiyute\b/gi, "institute")
      .replace(/\binstitite\b/gi, "institute")
      .replace(/\bfoundrs\b/gi, "founders");

    const result = await orchestrator.runLeadGenerationPipeline({
      query: cleanQuery,
      industry: industry || undefined,
      category: (category === "B2C" ? "B2C" : "B2B"),
      location: location || undefined,
      targetCount,
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || "Pipeline execution failed" });
  }
});

// ═══════════════════════════════════════════
// Pipeline Run Routes
// (MUST be before /:id routes to avoid "pipeline" matching as an agent ID)
// ═══════════════════════════════════════════

// GET /api/agents/pipeline/runs — List recent pipeline runs
agentsRouter.get("/pipeline/runs", async (_req, res) => {
  try {
    const runs = await dbQueries.getPipelineRuns(20);
    res.json({ success: true, count: runs.length, runs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

// GET /api/agents/pipeline/runs/:runId — Get pipeline run detail
agentsRouter.get("/pipeline/runs/:runId", async (req, res) => {
  try {
    const runId = req.params.runId;
    const run = await dbQueries.getPipelineRunById(runId);
    if (!run) {
      return res.status(404).json({ success: false, message: "Pipeline run not found" });
    }

    const executions = await dbQueries.getAgentExecutions(runId);

    res.json({
      success: true,
      run,
      agent_executions: executions,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

// ═══════════════════════════════════════════
// GET /api/agents/:id — Get single agent details
// (After all static routes above)
// ═══════════════════════════════════════════

agentsRouter.get("/:id", async (req, res) => {
  try {
    const agentId = req.params.id;
    const agent = await dbQueries.getAgentStatus(agentId);

    const isConfigured = agentGateway.isConfigured(agentId);
    const agentName = agentGateway.getAgentName(agentId);

    if (!agent) {
      return res.json({
        success: true,
        agent: {
          id: agentId,
          name: agentName,
          sarvam_configured: isConfigured,
          status: isConfigured ? "active" : "idle",
        },
      });
    }

    res.json({
      success: true,
      agent: {
        ...agent,
        sarvam_configured: isConfigured,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

// ═══════════════════════════════════════════
// POST /api/agents/:id/trigger — Trigger a single agent
// ═══════════════════════════════════════════

agentsRouter.post("/:id/trigger", async (req, res) => {
  try {
    const agentId = req.params.id;
    const input = req.body;

    if (!agentGateway.isConfigured(agentId)) {
      return res.status(400).json({
        success: false,
        message: `Agent ${agentId} is not configured on Sarvam AI. Add the agent ID to your .env file.`,
      });
    }

    const result = await agentGateway.runAgent(agentId, input);

    if (result && result.success) {
      res.json({
        success: true,
        agent_id: agentId,
        agent_name: agentGateway.getAgentName(agentId),
        output: result.output,
        execution_id: result.executionId,
        duration_ms: result.durationMs,
        tokens_used: result.tokensUsed,
      });
    } else {
      res.status(500).json({
        success: false,
        agent_id: agentId,
        error: result?.error || "Agent invocation failed",
      });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || "Agent trigger failed" });
  }
});

// ═══════════════════════════════════════════
// GET /api/agents/:id/logs — Get agent execution logs
// ═══════════════════════════════════════════

agentsRouter.get("/:id/logs", async (req, res) => {
  try {
    const agentId = req.params.id;

    const { dbClient } = require("@ai-lead-gen/database");
    const { data, error } = await dbClient
      .from("agent_logs")
      .select("*")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return res.json({ success: true, logs: [] });
    }

    res.json({ success: true, count: data?.length || 0, logs: data || [] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});
