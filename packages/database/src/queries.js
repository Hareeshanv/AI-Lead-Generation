"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dbQueries = void 0;
const client_1 = require("./client");
exports.dbQueries = {
    // Leads
    async getAllLeads() {
        const { data, error } = await client_1.dbClient.from("leads").select("*").order("created_at", { ascending: false });
        if (error) {
            console.warn("Supabase lead query error, returning empty list:", error.message);
            return [];
        }
        return data || [];
    },
    async insertLead(leadData) {
        const { data, error } = await client_1.dbClient.from("leads").insert([leadData]).select();
        if (error)
            throw new Error(`Supabase insert lead failed: ${error.message}`);
        return data?.[0];
    },
    async clearAllLeads() {
        const { error } = await client_1.dbClient.from("leads").delete().neq("id", "00000000-0000-0000-0000-000000000000");
        if (error) {
            console.warn("Failed to clear leads:", error.message);
            throw new Error(`Supabase clear leads failed: ${error.message}`);
        }
        console.log("[DB] All leads cleared from database.");
        return { success: true };
    },
    // Companies
    async getAllCompanies() {
        const { data, error } = await client_1.dbClient.from("companies").select("*").order("created_at", { ascending: false });
        if (error)
            return [];
        return data || [];
    },
    // Agents
    async getAgentStatus(agentId) {
        const { data, error } = await client_1.dbClient.from("agents").select("*").eq("id", agentId).single();
        if (error)
            return null;
        return data;
    },
    async updateAgentStatus(agentId, updates) {
        const { data, error } = await client_1.dbClient.from("agents").update(updates).eq("id", agentId).select();
        if (error)
            console.error("Update agent status failed:", error.message);
        return data?.[0];
    },
    async logAgentTelemetry(agentId, level, message) {
        await client_1.dbClient.from("agent_logs").insert([{ agent_id: agentId, level, message }]);
    },
    // Deals
    async getAllDeals() {
        const { data, error } = await client_1.dbClient.from("deals").select("*").order("created_at", { ascending: false });
        if (error)
            return [];
        return data || [];
    },
    async updateDealStage(dealId, stage) {
        const { data, error } = await client_1.dbClient.from("deals").update({ stage }).eq("id", dealId).select();
        if (error)
            throw new Error(error.message);
        return data?.[0];
    },
    // ═══════════════════════════════════════════
    // Pipeline Runs
    // ═══════════════════════════════════════════
    async createPipelineRun(runData) {
        const { data, error } = await client_1.dbClient.from("pipeline_runs").insert([runData]).select();
        if (error) {
            console.warn("Create pipeline run fallback:", error.message);
            return null;
        }
        return data?.[0];
    },
    async updatePipelineRun(runId, updates) {
        const { data, error } = await client_1.dbClient
            .from("pipeline_runs")
            .update(updates)
            .eq("id", runId)
            .select();
        if (error)
            console.warn("Update pipeline run failed:", error.message);
        return data?.[0];
    },
    async getPipelineRuns(limit = 20) {
        const { data, error } = await client_1.dbClient
            .from("pipeline_runs")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(limit);
        if (error)
            return [];
        return data || [];
    },
    async getPipelineRunById(runId) {
        const { data, error } = await client_1.dbClient
            .from("pipeline_runs")
            .select("*")
            .eq("id", runId)
            .single();
        if (error)
            return null;
        return data;
    },
    // ═══════════════════════════════════════════
    // Agent Executions (per-step tracking)
    // ═══════════════════════════════════════════
    async logAgentExecution(execData) {
        const { data, error } = await client_1.dbClient.from("agent_executions").insert([execData]).select();
        if (error) {
            console.warn("Log agent execution fallback:", error.message);
            return null;
        }
        return data?.[0];
    },
    async getAgentExecutions(pipelineRunId) {
        const { data, error } = await client_1.dbClient
            .from("agent_executions")
            .select("*")
            .eq("pipeline_run_id", pipelineRunId)
            .order("created_at", { ascending: true });
        if (error)
            return [];
        return data || [];
    },
    // ═══════════════════════════════════════════
    // Agent Status (all 14 agents)
    // ═══════════════════════════════════════════
    async getAllAgentStatuses() {
        const { data, error } = await client_1.dbClient.from("agents").select("*");
        if (error)
            return [];
        return data || [];
    },
};
