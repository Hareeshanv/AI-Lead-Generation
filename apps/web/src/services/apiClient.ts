import axios from "axios";
import { mockLeads, mockCompanies, mockAgents, mockWorkflows, mockCampaigns, mockDeals, mockAnalyticsData } from "@/lib/mockData";

export const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "/api",
  timeout: 10000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Request Interceptor (Inject Auth Token)
apiClient.interceptors.request.use(
  (config) => {
    if (typeof window !== "undefined") {
      const token = localStorage.getItem("auth_token");
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor (Unified Error & Refresh Token logic)
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      if (typeof window !== "undefined") {
        console.warn("Unauthorized access. Redirecting to login...");
      }
    }
    return Promise.reject(error);
  }
);

// High level mock API methods for client components
export const leadApi = {
  getLeads: async () => {
    return Promise.resolve(mockLeads);
  },
  getLeadById: async (id: string) => {
    return Promise.resolve(mockLeads.find((l) => l.id === id) || mockLeads[0]);
  },
};

export const companyApi = {
  getCompanies: async () => {
    return Promise.resolve(mockCompanies);
  },
};

export const agentApi = {
  getAgents: async () => {
    return Promise.resolve(mockAgents);
  },
  triggerAgent: async (agentId: string) => {
    return Promise.resolve({ success: true, message: `Triggered agent ${agentId}` });
  },
};

export const workflowApi = {
  getWorkflows: async () => {
    return Promise.resolve(mockWorkflows);
  },
};

export const campaignApi = {
  getCampaigns: async () => {
    return Promise.resolve(mockCampaigns);
  },
};

export const crmApi = {
  getDeals: async () => {
    return Promise.resolve(mockDeals);
  },
};

export const analyticsApi = {
  getOverview: async () => {
    return Promise.resolve(mockAnalyticsData);
  },
};
