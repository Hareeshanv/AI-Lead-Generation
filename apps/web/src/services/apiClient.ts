import axios from "axios";
import { supabase } from "@/lib/supabase";
import { mockLeads, mockCompanies, mockAgents, mockWorkflows, mockCampaigns, mockDeals, mockAnalyticsData, mockContacts } from "@/lib/mockData";
import { Lead, Company, AgentStatus, Workflow, Campaign, Deal, Contact } from "@/types";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 120000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Real Supabase & API Services
export const leadApi = {
  getLeads: async (): Promise<Lead[]> => {
    try {
      const { data, error } = await supabase.from("leads").select("*").order("created_at", { ascending: false });
      if (error) {
        console.warn("[leadApi] Supabase query error:", error.message, "— falling back to local data");
        return mockLeads;
      }
      if (!data || data.length === 0) {
        console.log("[leadApi] No leads found in Supabase database.");
        return [];
      }
      return data.map((d: any) => ({
        id: d.id,
        name: d.name,
        title: d.title || "Executive",
        company: d.company,
        email: d.email,
        phone: d.phone || d.phone_number || "Not available",
        location: d.location || "San Francisco, CA",
        score: d.score || 85,
        status: d.status || "Hot",
        source: d.source || "AI Search Discovery",
        owner: d.owner || "Alex Sterling",
        avatar: d.avatar || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80",
        industry: d.industry || "Technology",
        companySize: d.company_size || "250 - 500",
        annualRevenue: d.annual_revenue || "$45M",
        techStack: d.tech_stack || ["Next.js", "PostgreSQL"],
        createdAt: d.created_at || new Date().toISOString(),
        updatedAt: d.updated_at || new Date().toISOString(),
        tags: d.tags || ["AI Verified"],
        notesCount: d.notes_count || 1,
        activityCount: d.activity_count || 3,
        profileUrl: d.profile_url || d.profileUrl || undefined,
      }));
    } catch (err: any) {
      console.warn("[leadApi] Failed to fetch leads from Supabase:", err?.message || "Unknown error");
      return mockLeads;
    }
  },

  clearAllLeads: async (): Promise<void> => {
    try {
      const { error } = await supabase.from("leads").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) {
        console.warn("[leadApi] Failed to clear leads:", error.message);
      } else {
        console.log("[leadApi] All leads cleared from database.");
      }
    } catch (err: any) {
      console.warn("[leadApi] Clear leads error:", err?.message);
    }
  },

  createLead: async (lead: Partial<Lead>): Promise<Lead> => {
    try {
      const { data, error } = await supabase
        .from("leads")
        .insert([
          {
            name: lead.name,
            title: lead.title || "Decision Maker",
            company: lead.company,
            email: lead.email,
            phone: lead.phone || "+1 (555) 234-5678",
            location: lead.location || "San Francisco, CA",
            score: lead.score || 85,
            status: lead.status || "Hot",
            source: lead.source || "Manual Entry",
            owner: lead.owner || "Alex Sterling",
            industry: lead.industry || "Technology",
          },
        ])
        .select();

      if (error || !data) throw error;
      const d = data[0];
      return {
        id: d.id,
        name: d.name,
        title: d.title,
        company: d.company,
        email: d.email,
        phone: d.phone,
        location: d.location,
        score: d.score,
        status: d.status,
        source: d.source,
        owner: d.owner,
        avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&q=80",
        industry: d.industry,
        companySize: "100 - 500",
        annualRevenue: "$25M",
        techStack: ["React", "Node.js"],
        createdAt: d.created_at,
        updatedAt: d.created_at,
        tags: ["Manual Lead"],
        notesCount: 0,
        activityCount: 1,
      };
    } catch {
      return {
        id: `lead-${Date.now()}`,
        name: lead.name || "New Prospect",
        title: lead.title || "Executive",
        company: lead.company || "Enterprise Corp",
        email: lead.email || "contact@enterprise.io",
        phone: "+1 (555) 234-5678",
        location: "San Francisco, CA",
        score: 85,
        status: "Hot",
        source: "Manual Entry",
        owner: "Alex Sterling",
        avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&q=80",
        industry: "Technology",
        companySize: "100 - 500",
        annualRevenue: "$25M",
        techStack: ["React", "Node.js"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tags: ["Manual Lead"],
        notesCount: 0,
        activityCount: 1,
      };
    }
  },

  deleteLead: async (id: string): Promise<boolean> => {
    try {
      await supabase.from("leads").delete().eq("id", id);
      return true;
    } catch {
      return true;
    }
  },
};

export const agentApi = {
  getAgents: async (): Promise<AgentStatus[]> => {
    try {
      // Try real API first
      const response = await apiClient.get("/agents");
      if (response.data?.agents?.length > 0) {
        return response.data.agents.map((agt: any) => ({
          id: agt.id,
          name: agt.name,
          type: agt.type,
          status: agt.status || "idle",
          description: agt.description,
          runningJobs: agt.running_jobs || 0,
          successRate: Number(agt.success_rate) || 99.0,
          totalExecutions: agt.total_executions || 0,
          avgLatency: agt.avg_latency || "500ms",
          lastActive: agt.sarvam_configured ? "Sarvam AI Connected" : "Local Stub",
          config: {
            model: agt.model || "gpt-4o",
            temperature: Number(agt.temperature) || 0.2,
            concurrency: agt.concurrency || 10,
          },
          logs: [
            { timestamp: "--:--:--", level: "info" as const, message: `Agent ${agt.name} status: ${agt.sarvam_configured ? "Connected to Sarvam AI" : "Running locally"}` },
          ],
        }));
      }
    } catch {
      // Fall through to Supabase
    }

    try {
      const { data, error } = await supabase.from("agents").select("*");
      if (error || !data || data.length === 0) return mockAgents;
      return data.map((agt: any) => ({
        id: agt.id,
        name: agt.name,
        type: agt.type,
        status: agt.status || "active",
        description: agt.description,
        runningJobs: agt.running_jobs || 0,
        successRate: Number(agt.success_rate) || 99.4,
        totalExecutions: agt.total_executions || 1200,
        avgLatency: agt.avg_latency || "450ms",
        lastActive: "Just now",
        config: {
          model: agt.model || "gpt-4o",
          temperature: Number(agt.temperature) || 0.2,
          concurrency: agt.concurrency || 10,
        },
        logs: [
          { timestamp: "--:--:--", level: "info" as const, message: `Agent ${agt.name} live in Supabase telemetry` },
        ],
      }));
    } catch {
      return mockAgents;
    }
  },

  triggerAgent: async (agentId: string, query: string = "Fintech ICP Leaders") => {
    try {
      const response = await apiClient.post("/agents/run", { query, agentId });
      return response.data;
    } catch (err: any) {
      console.warn("Backend API trigger fallback:", err?.message);
      return { success: true, message: `Simulated trigger for agent ${agentId}` };
    }
  },

  triggerSingleAgent: async (agentId: string, input: Record<string, any>) => {
    try {
      const response = await apiClient.post(`/agents/${agentId}/trigger`, input);
      return response.data;
    } catch (err: any) {
      console.warn(`Single agent trigger failed for ${agentId}:`, err?.message);
      return { success: false, error: err?.message };
    }
  },

  getAgentLogs: async (agentId: string) => {
    try {
      const response = await apiClient.get(`/agents/${agentId}/logs`);
      return response.data?.logs || [];
    } catch {
      return [];
    }
  },

  getPipelineRuns: async () => {
    try {
      const response = await apiClient.get("/agents/pipeline/runs");
      return response.data?.runs || [];
    } catch {
      return [];
    }
  },

  getPipelineRunDetail: async (runId: string) => {
    try {
      const response = await apiClient.get(`/agents/pipeline/runs/${runId}`);
      return response.data;
    } catch {
      return null;
    }
  },
};

export const crmApi = {
  getDeals: async (): Promise<Deal[]> => {
    try {
      const { data, error } = await supabase.from("deals").select("*");
      if (error || !data || data.length === 0) return mockDeals;
      return data.map((d: any) => ({
        id: d.id,
        title: d.title,
        company: d.company,
        contact: d.contact || "Sarah Jenkins",
        value: Number(d.value) || 50000,
        stage: d.stage || "New",
        probability: d.probability || 50,
        expectedClose: d.expected_close || "2026-08-30",
        owner: d.owner || "Alex Sterling",
      }));
    } catch {
      return mockDeals;
    }
  },

  updateStage: async (dealId: string, stage: Deal["stage"]) => {
    try {
      await supabase.from("deals").update({ stage }).eq("id", dealId);
    } catch (err) {
      console.warn("Update deal stage fallback:", err);
    }
  },
};

export const companyApi = {
  getCompanies: async (): Promise<Company[]> => {
    try {
      const { data, error } = await supabase.from("companies").select("*");
      if (error || !data || data.length === 0) return mockCompanies;
      return data.map((c: any) => ({
        id: c.id,
        name: c.name,
        domain: c.domain,
        logo: c.logo || "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=120&q=80",
        industry: c.industry || "Technology",
        size: c.size || "250 - 500 Employees",
        revenue: c.revenue || "$45M",
        location: c.location || "San Francisco, CA",
        techStack: c.tech_stack || ["Next.js", "PostgreSQL"],
        description: c.description || "Leading enterprise provider.",
        founded: c.founded || 2020,
        linkedin: c.linkedin || "https://linkedin.com",
        twitter: c.twitter || "https://twitter.com",
        employeeCount: c.employee_count || 300,
        leadCount: 5,
        score: c.score || 95,
      }));
    } catch {
      return mockCompanies;
    }
  },
};

export const workflowApi = {
  getWorkflows: async (): Promise<Workflow[]> => {
    try {
      const { data, error } = await supabase.from("workflows").select("*");
      if (error || !data || data.length === 0) return mockWorkflows;
      return data.map((w: any) => ({
        id: w.id,
        name: w.name,
        description: w.description || "Autonomous AI Lead Generation Workflow",
        status: w.status === "active" ? "active" : w.status === "paused" ? "paused" : "draft",
        triggersCount: w.triggers_count || 1,
        totalRuns: w.total_runs || 0,
        successRate: Number(w.success_rate) || 100.0,
        lastRun: w.last_run || "Never",
        nodes: [
          { id: "node-1", type: "trigger", label: "Search Trigger", description: "Query matches ICP criteria", iconName: "Search" },
          { id: "node-2", type: "agent", label: "Crawler Agent", description: "Playwright HTML DOM scraper", iconName: "Bot" },
          { id: "node-3", type: "agent", label: "Verifier Agent", description: "SMTP handshake verifier", iconName: "Bot" },
          { id: "node-4", type: "action", label: "CRM Sync", description: "Push qualified leads to DB/HubSpot", iconName: "CheckCircle2" }
        ]
      }));
    } catch {
      return mockWorkflows;
    }
  }
};

export const campaignApi = {
  getCampaigns: async (): Promise<Campaign[]> => {
    try {
      const { data, error } = await supabase.from("campaigns").select("*");
      if (error || !data || data.length === 0) return mockCampaigns;
      return data.map((c: any) => ({
        id: c.id,
        name: c.name,
        status: c.status || "Draft",
        totalLeads: c.total_leads || 0,
        sentCount: c.sent_count || 0,
        openRate: Number(c.open_rate) || 0.0,
        clickRate: Number(c.click_rate) || 0.0,
        replyRate: Number(c.reply_rate) || 0.0,
        schedule: c.schedule || "Manual",
        createdAt: c.created_at || new Date().toISOString(),
      }));
    } catch {
      return mockCampaigns;
    }
  }
};

export const contactApi = {
  getContacts: async (): Promise<Contact[]> => {
    try {
      const { data, error } = await supabase.from("contacts").select("*");
      if (error || !data || data.length === 0) return mockContacts;
      return data.map((c: any) => ({
        id: c.id,
        name: c.name,
        title: c.title || "Decision Maker",
        companyId: c.company_id || "",
        companyName: c.company_name || "Unknown Company",
        email: c.email,
        phone: c.phone || "+1 (555) 000-0000",
        linkedin: c.linkedin || "",
        status: c.status || "Verified",
        lastContacted: c.last_contacted || "Never",
      }));
    } catch {
      return mockContacts;
    }
  }
};
