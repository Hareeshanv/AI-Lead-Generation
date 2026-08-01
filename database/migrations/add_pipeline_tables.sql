-- ═══════════════════════════════════════════════════════════════
-- Pipeline Runs — tracks each complete pipeline execution
-- ═══════════════════════════════════════════════════════════════

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

-- ═══════════════════════════════════════════════════════════════
-- Agent Executions — tracks each individual agent run within a pipeline
-- ═══════════════════════════════════════════════════════════════

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

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_created ON pipeline_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_executions_pipeline ON agent_executions(pipeline_run_id);
CREATE INDEX IF NOT EXISTS idx_agent_executions_agent ON agent_executions(agent_id);

-- ═══════════════════════════════════════════════════════════════
-- Enable RLS (Row Level Security) — open for now, lock down later
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_executions ENABLE ROW LEVEL SECURITY;

-- Allow full access from authenticated and anon roles (dev mode)
CREATE POLICY "Allow all pipeline_runs access" ON pipeline_runs
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all agent_executions access" ON agent_executions
  FOR ALL USING (true) WITH CHECK (true);
