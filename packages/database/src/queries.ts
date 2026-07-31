import { dbClient } from "./client";

export const dbQueries = {
  // Leads
  async getAllLeads() {
    const { data, error } = await dbClient.from("leads").select("*").order("created_at", { ascending: false });
    if (error) {
      console.warn("Supabase lead query error, returning empty list:", error.message);
      return [];
    }
    return data || [];
  },

  async insertLead(leadData: Record<string, any>) {
    const { data, error } = await dbClient.from("leads").insert([leadData]).select();
    if (error) throw new Error(`Supabase insert lead failed: ${error.message}`);
    return data?.[0];
  },

  // Companies
  async getAllCompanies() {
    const { data, error } = await dbClient.from("companies").select("*").order("created_at", { ascending: false });
    if (error) return [];
    return data || [];
  },

  // Agents
  async getAgentStatus(agentId: string) {
    const { data, error } = await dbClient.from("agents").select("*").eq("id", agentId).single();
    if (error) return null;
    return data;
  },

  async updateAgentStatus(agentId: string, updates: Record<string, any>) {
    const { data, error } = await dbClient.from("agents").update(updates).eq("id", agentId).select();
    if (error) console.error("Update agent status failed:", error.message);
    return data?.[0];
  },

  async logAgentTelemetry(agentId: string, level: "info" | "warn" | "error", message: string) {
    await dbClient.from("agent_logs").insert([{ agent_id: agentId, level, message }]);
  },

  // Deals
  async getAllDeals() {
    const { data, error } = await dbClient.from("deals").select("*").order("created_at", { ascending: false });
    if (error) return [];
    return data || [];
  },

  async updateDealStage(dealId: string, stage: string) {
    const { data, error } = await dbClient.from("deals").update({ stage }).eq("id", dealId).select();
    if (error) throw new Error(error.message);
    return data?.[0];
  },
};
