export type LeadStatus = "Hot" | "Warm" | "Cold" | "Qualified" | "New" | "Contacted" | "Closed";

export interface Lead {
  id: string;
  name: string;
  title: string;
  company: string;
  email: string;
  phone: string;
  location: string;
  score: number; // 0 to 100
  status: LeadStatus;
  source: string;
  owner: string;
  avatar: string;
  industry: string;
  companySize: string;
  annualRevenue: string;
  techStack: string[];
  createdAt: string;
  updatedAt: string;
  tags: string[];
  notesCount: number;
  activityCount: number;
}

export interface Company {
  id: string;
  name: string;
  domain: string;
  logo: string;
  industry: string;
  size: string;
  revenue: string;
  location: string;
  techStack: string[];
  description: string;
  founded: number;
  linkedin: string;
  twitter: string;
  employeeCount: number;
  leadCount: number;
  score: number;
}

export interface Contact {
  id: string;
  name: string;
  title: string;
  companyId: string;
  companyName: string;
  email: string;
  phone: string;
  linkedin: string;
  status: "Verified" | "Pending" | "Bounced";
  lastContacted: string;
}

export interface AgentStatus {
  id: string;
  name: string;
  type: string;
  status: "active" | "idle" | "running" | "error" | "paused";
  description: string;
  runningJobs: number;
  successRate: number;
  totalExecutions: number;
  avgLatency: string;
  lastActive: string;
  config: {
    model: string;
    temperature: number;
    concurrency: number;
  };
  logs: { timestamp: string; level: "info" | "warn" | "error"; message: string }[];
}

export interface WorkflowNode {
  id: string;
  type: "trigger" | "agent" | "condition" | "action";
  label: string;
  description: string;
  iconName: string;
  status?: "success" | "active" | "idle";
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  status: "active" | "draft" | "paused";
  triggersCount: number;
  totalRuns: number;
  successRate: number;
  lastRun: string;
  nodes: WorkflowNode[];
}

export interface Campaign {
  id: string;
  name: string;
  status: "Active" | "Draft" | "Completed" | "Paused";
  totalLeads: number;
  sentCount: number;
  openRate: number; // %
  clickRate: number; // %
  replyRate: number; // %
  schedule: string;
  createdAt: string;
}

export interface Deal {
  id: string;
  title: string;
  company: string;
  contact: string;
  value: number;
  stage: "New" | "Qualified" | "Proposal" | "Negotiation" | "Closed Won" | "Closed Lost";
  probability: number;
  expectedClose: string;
  owner: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  type: "lead" | "agent" | "workflow" | "system";
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar: string;
  organization: string;
  plan: string;
  twoFactorEnabled: boolean;
}
