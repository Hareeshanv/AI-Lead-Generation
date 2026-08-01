-- Enable pgvector extension for AI embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Users & Organizations
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'Admin',
    avatar TEXT,
    organization TEXT DEFAULT 'Nexus AI Growth Corp',
    plan TEXT DEFAULT 'Enterprise Platinum AI',
    two_factor_enabled BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Companies
CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    domain TEXT UNIQUE NOT NULL,
    logo TEXT,
    industry TEXT,
    size TEXT,
    revenue TEXT,
    location TEXT,
    tech_stack TEXT[],
    description TEXT,
    founded INTEGER,
    linkedin TEXT,
    twitter TEXT,
    employee_count INTEGER DEFAULT 0,
    score INTEGER DEFAULT 0,
    embedding vector(1536),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Contacts
CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    title TEXT,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    company_name TEXT,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    linkedin TEXT,
    status TEXT DEFAULT 'Verified',
    last_contacted TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Leads
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    title TEXT,
    company TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    location TEXT,
    score INTEGER DEFAULT 50,
    status TEXT DEFAULT 'New',
    source TEXT,
    owner TEXT,
    avatar TEXT,
    industry TEXT,
    company_size TEXT,
    annual_revenue TEXT,
    tech_stack TEXT[],
    tags TEXT[],
    notes_count INTEGER DEFAULT 0,
    activity_count INTEGER DEFAULT 0,
    embedding vector(1536),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. AI Agents Status & Configuration
CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT DEFAULT 'idle',
    description TEXT,
    running_jobs INTEGER DEFAULT 0,
    success_rate NUMERIC(5,2) DEFAULT 99.00,
    total_executions INTEGER DEFAULT 0,
    avg_latency TEXT DEFAULT '500ms',
    model TEXT DEFAULT 'gpt-4o',
    temperature NUMERIC(3,2) DEFAULT 0.20,
    concurrency INTEGER DEFAULT 10,
    last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. AI Agent Telemetry Logs
CREATE TABLE IF NOT EXISTS agent_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
    level TEXT DEFAULT 'info',
    message TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. Workflows
CREATE TABLE IF NOT EXISTS workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'active',
    triggers_count INTEGER DEFAULT 1,
    total_runs INTEGER DEFAULT 0,
    success_rate NUMERIC(5,2) DEFAULT 100.00,
    last_run TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. Campaigns
CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    status TEXT DEFAULT 'Draft',
    total_leads INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    open_rate NUMERIC(5,2) DEFAULT 0.00,
    click_rate NUMERIC(5,2) DEFAULT 0.00,
    reply_rate NUMERIC(5,2) DEFAULT 0.00,
    schedule TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. Deals (CRM Kanban Pipeline)
CREATE TABLE IF NOT EXISTS deals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    contact TEXT,
    value NUMERIC(12,2) DEFAULT 0.00,
    stage TEXT DEFAULT 'New',
    probability INTEGER DEFAULT 50,
    expected_close DATE,
    owner TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed Initial AI Agent Fleet Data
INSERT INTO agents (id, name, type, status, description, running_jobs, success_rate, total_executions, avg_latency, model, temperature, concurrency) VALUES
('agt-planner', 'Planner Agent', 'Strategy & Orchestration', 'active', 'Decomposes lead gen goals into sub-tasks and selects target ICP search channels.', 3, 99.40, 1420, '450ms', 'gpt-4o', 0.20, 5),
('agt-search', 'Search Discovery Agent', 'Lead Discovery', 'running', 'Scans Google, Bing, LinkedIn, and GitHub for companies matching ICP criteria.', 8, 98.10, 8900, '1.2s', 'gpt-4o-mini', 0.40, 12),
('agt-crawler', 'Web Crawler Agent', 'Scraping & DOM Parsing', 'running', 'Executes headless Playwright browsers to capture DOM, tech stack, and contact pages.', 14, 96.80, 12400, '2.8s', 'custom-puppeteer-v2', 0.00, 20),
('agt-extractor', 'Structured Extractor Agent', 'Information Extraction', 'active', 'Converts raw unstructured HTML and text into JSON lead schemas.', 2, 99.10, 9450, '820ms', 'gpt-4o', 0.10, 10),
('agt-enrichment', 'Company & Contact Enrichment Agent', 'Enrichment Engine', 'active', 'Cross-references company data with Clearbit, Apollo, and social profiles.', 4, 97.50, 6700, '1.5s', 'claude-3-5-sonnet', 0.20, 8),
('agt-verifier', 'Email & Phone Verifier Agent', 'Verification & Deliverability', 'active', 'Performs real-time MX record checks, SMTP handshakes, and phone validation.', 6, 99.80, 15200, '310ms', 'rule-engine-v1', 0.00, 30),
('agt-scoring', 'ICP Lead Scoring Agent', 'Predictive Qualification', 'active', 'Scores leads from 0-100 based on company size, revenue, tech stack, and intent signals.', 1, 100.00, 11000, '150ms', 'custom-random-forest', 0.10, 15),
('agt-outreach', 'Hyper-Personalized Outreach Agent', 'Messaging & Copywriting', 'active', 'Generates custom 1-on-1 cold email copy referencing prospect news and tech stack.', 5, 98.90, 4300, '1.1s', 'gpt-4o', 0.70, 5)
ON CONFLICT (id) DO NOTHING;
