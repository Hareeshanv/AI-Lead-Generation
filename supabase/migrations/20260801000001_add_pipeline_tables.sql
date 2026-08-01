-- Migration: Add pipeline tracking tables and seed missing agents

-- 1. Create pipeline_runs table
CREATE TABLE IF NOT EXISTS pipeline_runs (
    id TEXT PRIMARY KEY DEFAULT ('run-' || substr(gen_random_uuid()::text, 1, 12)),
    campaign_name TEXT NOT NULL,
    query TEXT NOT NULL,
    industry TEXT DEFAULT 'Technology',
    category TEXT DEFAULT 'B2B',
    location TEXT DEFAULT 'Global',
    target_count INT DEFAULT 50,
    status TEXT DEFAULT 'running',            -- running, completed, completed_with_errors, failed
    total_leads_found INT DEFAULT 0,
    verified_leads INT DEFAULT 0,
    high_score_leads INT DEFAULT 0,
    emails_generated INT DEFAULT 0,
    crm_synced INT DEFAULT 0,
    duration_ms INT,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS & Policies for pipeline_runs
ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'pipeline_runs' AND policyname = 'Allow all pipeline_runs access'
    ) THEN
        CREATE POLICY "Allow all pipeline_runs access" ON pipeline_runs FOR ALL USING (true) WITH CHECK (true);
    END IF;
END
$$;

-- 2. Create agent_executions table
CREATE TABLE IF NOT EXISTS agent_executions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    pipeline_run_id TEXT REFERENCES pipeline_runs(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,                   -- e.g. "agt-search"
    agent_name TEXT NOT NULL,                 -- e.g. "Search Discovery"
    status TEXT DEFAULT 'pending',            -- pending, running, completed, failed, skipped
    input JSONB,
    output JSONB,
    error TEXT,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    duration_ms INT DEFAULT 0,
    tokens_used INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS & Policies for agent_executions
ALTER TABLE agent_executions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'agent_executions' AND policyname = 'Allow all agent_executions access'
    ) THEN
        CREATE POLICY "Allow all agent_executions access" ON agent_executions FOR ALL USING (true) WITH CHECK (true);
    END IF;
END
$$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_created ON pipeline_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_executions_pipeline ON agent_executions(pipeline_run_id);
CREATE INDEX IF NOT EXISTS idx_agent_executions_agent ON agent_executions(agent_id);

-- 3. Seed missing agent records
INSERT INTO agents (id, name, type, status, description, running_jobs, success_rate, total_executions, avg_latency, model, temperature, concurrency) VALUES
('agt-deduplication', 'Entity Deduplication Agent', 'Data Quality', 'idle', 'Prevents duplicate leads using email normalization, fuzzy matching, and DB checks.', 0, 99.90, 0, '50ms', 'rule-engine-v1', 0.00, 20),
('agt-crm', 'CRM Synchronization Agent', 'Integration & Sync', 'idle', 'Pushes verified high-scoring leads to HubSpot, Salesforce, or custom CRMs.', 0, 98.50, 0, '1.1s', 'gpt-4o-mini', 0.10, 5),
('agt-report', 'Report Generator Agent', 'Reporting & Export', 'idle', 'Compiles pipeline statistics and generates PDF/CSV executive reports.', 0, 99.20, 0, '2.5s', 'gpt-4o', 0.30, 3),
('agt-analytics', 'Analytics & ROI Tracker Agent', 'Observability & Metrics', 'active', 'Tracks agent execution times, success rates, API token costs, and conversions.', 0, 99.70, 0, '200ms', 'gpt-4o-mini', 0.10, 3),
('agt-scheduler', 'Task & Lifecycle Scheduler Agent', 'Automation & Scheduling', 'active', 'Manages cron-based scheduled runs, retry logic, and follow-up sequences.', 0, 99.50, 0, '100ms', 'gpt-4o-mini', 0.10, 3),
('agt-orchestrator', 'Master Orchestrator Agent', 'Multi-Agent Coordinator', 'active', 'The master controller that coordinates all agents in the lead generation pipeline.', 0, 99.80, 0, '350ms', 'gpt-4o', 0.20, 5)
ON CONFLICT (id) DO NOTHING;
