import { Lead, Company, Contact, AgentStatus, Workflow, Campaign, Deal, NotificationItem, UserProfile } from "@/types";

export const mockCurrentUser: UserProfile = {
  id: "usr-01",
  name: "Alex Sterling",
  email: "alex.sterling@enterprise-ai.io",
  role: "Chief Revenue Officer & Admin",
  avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=256&q=80",
  organization: "Nexus AI Growth Corp",
  plan: "Enterprise Platinum AI",
  twoFactorEnabled: true,
};

// All dummy lead, company, contact, campaign, and deal lists cleared out for clean production state
export const mockLeads: Lead[] = [];

export const mockCompanies: Company[] = [];

export const mockContacts: Contact[] = [];

export const mockWorkflows: Workflow[] = [
  {
    id: "wf-1",
    name: "Enterprise B2B Lead Discovery & Verification",
    description: "End-to-end multi-agent pipeline for finding, enriching, verifying phone/email, and scoring B2B leads.",
    status: "active",
    triggersCount: 4,
    totalRuns: 342,
    successRate: 98.8,
    lastRun: "10 mins ago",
    nodes: [
      { id: "n1", type: "trigger", label: "New Campaign Trigger", description: "Fires when user starts target search", iconName: "Play", status: "success" },
      { id: "n2", type: "agent", label: "Search Discovery Agent", description: "Scans Google & LinkedIn", iconName: "Search", status: "active" },
      { id: "n3", type: "agent", label: "Email & Phone Verifier", description: "SMTP ping & phone line validation", iconName: "ShieldCheck", status: "idle" },
      { id: "n4", type: "agent", label: "ICP & Persona Scorer", description: "Scores leads from 0 to 100", iconName: "Flame", status: "idle" },
    ],
  },
];

export const mockCampaigns: Campaign[] = [];

export const mockDeals: Deal[] = [];

export const mockNotifications: NotificationItem[] = [];

export const mockAgents: AgentStatus[] = [
  {
    id: "agt-planner",
    name: "Planner Agent",
    type: "Strategy & Orchestration",
    status: "active",
    description: "Decomposes lead gen goals into sub-tasks and selects target ICP search channels.",
    runningJobs: 0,
    successRate: 99.4,
    totalExecutions: 0,
    avgLatency: "450ms",
    lastActive: "Ready",
    config: { model: "gpt-4o", temperature: 0.2, concurrency: 5 },
    logs: [
      { timestamp: new Date().toLocaleTimeString(), level: "info", message: "Planner Agent initialized and ready for new target inputs." },
    ],
  },
  {
    id: "agt-search",
    name: "Search Discovery Agent",
    type: "Lead Discovery",
    status: "idle",
    description: "Scans Google, Bing, LinkedIn, and GitHub for companies matching ICP criteria.",
    runningJobs: 0,
    successRate: 98.1,
    totalExecutions: 0,
    avgLatency: "1.2s",
    lastActive: "Ready",
    config: { model: "gpt-4o-mini", temperature: 0.4, concurrency: 12 },
    logs: [
      { timestamp: new Date().toLocaleTimeString(), level: "info", message: "Search Discovery Agent ready for B2B/B2C query runs." },
    ],
  },
  {
    id: "agt-crawler",
    name: "Web Scraping & Crawling Agent",
    type: "Data Scraping",
    status: "idle",
    description: "Extracts contact pages, executive profiles, and company tech stack details.",
    runningJobs: 0,
    successRate: 97.6,
    totalExecutions: 0,
    avgLatency: "2.1s",
    lastActive: "Ready",
    config: { model: "claude-3-5-sonnet", temperature: 0.1, concurrency: 10 },
    logs: [
      { timestamp: new Date().toLocaleTimeString(), level: "info", message: "Web Scraper Agent standby mode active." },
    ],
  },
  {
    id: "agt-verifier",
    name: "Email & Phone Verifier Agent",
    type: "Verification & Deliverability",
    status: "active",
    description: "Performs real-time MX record checks, SMTP handshakes, and phone line validation.",
    runningJobs: 0,
    successRate: 99.8,
    totalExecutions: 0,
    avgLatency: "310ms",
    lastActive: "Ready",
    config: { model: "rule-engine-v1", temperature: 0.0, concurrency: 30 },
    logs: [
      { timestamp: new Date().toLocaleTimeString(), level: "info", message: "Verifier Engine active. Ready to validate emails & phone numbers." },
    ],
  },
  {
    id: "agt-scoring",
    name: "ICP & Persona Scorer Agent",
    type: "Qualification & Scoring",
    status: "idle",
    description: "Evaluates B2B firmographic match and B2C buyer intent signals (0-100 score).",
    runningJobs: 0,
    successRate: 99.1,
    totalExecutions: 0,
    avgLatency: "180ms",
    lastActive: "Ready",
    config: { model: "gpt-4o", temperature: 0.1, concurrency: 15 },
    logs: [
      { timestamp: new Date().toLocaleTimeString(), level: "info", message: "Lead Scorer Agent waiting for incoming data batches." },
    ],
  },
  {
    id: "agt-outreach",
    name: "Outreach & Copywriter Agent",
    type: "Personalization",
    status: "idle",
    description: "Generates personalized cold emails, LinkedIn InMails, and SMS outreach copy.",
    runningJobs: 0,
    successRate: 96.5,
    totalExecutions: 0,
    avgLatency: "1.8s",
    lastActive: "Ready",
    config: { model: "gpt-4o", temperature: 0.7, concurrency: 8 },
    logs: [
      { timestamp: new Date().toLocaleTimeString(), level: "info", message: "Outreach Writer Agent standby mode active." },
    ],
  },
  {
    id: "agt-extractor",
    name: "Data Extractor Agent",
    type: "NLP & Extraction",
    status: "idle",
    description: "Transforms raw unstructured text into clean structured lead data using LLMs.",
    runningJobs: 0,
    successRate: 97.3,
    totalExecutions: 0,
    avgLatency: "900ms",
    lastActive: "Ready",
    config: { model: "gpt-4o", temperature: 0.1, concurrency: 8 },
    logs: [
      { timestamp: new Date().toLocaleTimeString(), level: "info", message: "Data Extractor Agent initialized." },
    ],
  },
  {
    id: "agt-enrichment",
    name: "Business Enrichment Agent",
    type: "Data Enrichment",
    status: "idle",
    description: "Appends firmographic, technographic, and social data to lead profiles.",
    runningJobs: 0,
    successRate: 96.8,
    totalExecutions: 0,
    avgLatency: "1.5s",
    lastActive: "Ready",
    config: { model: "gpt-4o-mini", temperature: 0.3, concurrency: 15 },
    logs: [
      { timestamp: new Date().toLocaleTimeString(), level: "info", message: "Enrichment Agent ready for data augmentation." },
    ],
  },
  {
    id: "agt-deduplication",
    name: "Entity Deduplication Agent",
    type: "Data Quality",
    status: "idle",
    description: "Prevents duplicate leads using email normalization, fuzzy matching, and DB checks.",
    runningJobs: 0,
    successRate: 99.9,
    totalExecutions: 0,
    avgLatency: "50ms",
    lastActive: "Ready",
    config: { model: "rule-engine-v1", temperature: 0.0, concurrency: 20 },
    logs: [
      { timestamp: new Date().toLocaleTimeString(), level: "info", message: "Deduplication Engine online." },
    ],
  },
  {
    id: "agt-crm",
    name: "CRM Synchronization Agent",
    type: "Integration & Sync",
    status: "idle",
    description: "Pushes verified high-scoring leads to HubSpot, Salesforce, or custom CRMs.",
    runningJobs: 0,
    successRate: 98.5,
    totalExecutions: 0,
    avgLatency: "1.1s",
    lastActive: "Ready",
    config: { model: "gpt-4o-mini", temperature: 0.1, concurrency: 5 },
    logs: [
      { timestamp: new Date().toLocaleTimeString(), level: "info", message: "CRM Sync Agent awaiting qualified leads." },
    ],
  },
  {
    id: "agt-report",
    name: "Report Generator Agent",
    type: "Reporting & Export",
    status: "idle",
    description: "Compiles pipeline statistics and generates PDF/CSV executive reports.",
    runningJobs: 0,
    successRate: 99.2,
    totalExecutions: 0,
    avgLatency: "2.5s",
    lastActive: "Ready",
    config: { model: "gpt-4o", temperature: 0.3, concurrency: 3 },
    logs: [
      { timestamp: new Date().toLocaleTimeString(), level: "info", message: "Report Generator Agent on standby." },
    ],
  },
  {
    id: "agt-analytics",
    name: "Analytics & ROI Tracker Agent",
    type: "Observability & Metrics",
    status: "active",
    description: "Tracks agent execution times, success rates, API token costs, and conversions.",
    runningJobs: 0,
    successRate: 99.7,
    totalExecutions: 0,
    avgLatency: "200ms",
    lastActive: "Ready",
    config: { model: "gpt-4o-mini", temperature: 0.1, concurrency: 3 },
    logs: [
      { timestamp: new Date().toLocaleTimeString(), level: "info", message: "Analytics Tracker actively monitoring system metrics." },
    ],
  },
  {
    id: "agt-scheduler",
    name: "Task & Lifecycle Scheduler Agent",
    type: "Automation & Scheduling",
    status: "active",
    description: "Manages cron-based scheduled runs, retry logic, and follow-up sequences.",
    runningJobs: 0,
    successRate: 99.5,
    totalExecutions: 0,
    avgLatency: "100ms",
    lastActive: "Ready",
    config: { model: "gpt-4o-mini", temperature: 0.1, concurrency: 3 },
    logs: [
      { timestamp: new Date().toLocaleTimeString(), level: "info", message: "Scheduler Agent managing automated task lifecycle." },
    ],
  },
  {
    id: "agt-orchestrator",
    name: "Master Orchestrator Agent",
    type: "Multi-Agent Coordinator",
    status: "active",
    description: "The master controller that coordinates all agents in the lead generation pipeline.",
    runningJobs: 0,
    successRate: 99.8,
    totalExecutions: 0,
    avgLatency: "350ms",
    lastActive: "Ready",
    config: { model: "gpt-4o", temperature: 0.2, concurrency: 5 },
    logs: [
      { timestamp: new Date().toLocaleTimeString(), level: "info", message: "Master Orchestrator ready to coordinate pipeline runs." },
    ],
  },
];

export const mockAnalyticsData = {
  monthlyGrowth: [
    { month: "Jan", leads: 0, conversion: 0, revenue: 0 },
    { month: "Feb", leads: 0, conversion: 0, revenue: 0 },
    { month: "Mar", leads: 0, conversion: 0, revenue: 0 },
    { month: "Apr", leads: 0, conversion: 0, revenue: 0 },
    { month: "May", leads: 0, conversion: 0, revenue: 0 },
    { month: "Jun", leads: 0, conversion: 0, revenue: 0 },
    { month: "Jul", leads: 0, conversion: 0, revenue: 0 },
  ],
  leadSources: [] as { name: string; value: number; color: string }[],
  industryDistribution: [] as { name: string; percentage: number }[],
};
