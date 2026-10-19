-- Student Discovery Agent: intent signals found through web search (Serper.dev) and scored by Sarvam.
-- Adds discovery metadata only. Still NO phone / email columns: author_handle is the public
-- username or display name shown on the post.
-- Idempotent: safe to re-run.

ALTER TABLE public.intent_signals ADD COLUMN IF NOT EXISTS author_handle TEXT;
ALTER TABLE public.intent_signals ADD COLUMN IF NOT EXISTS platform TEXT;
ALTER TABLE public.intent_signals ADD COLUMN IF NOT EXISTS search_query TEXT;
ALTER TABLE public.intent_signals ADD COLUMN IF NOT EXISTS search_city TEXT;
ALTER TABLE public.intent_signals ADD COLUMN IF NOT EXISTS discovered_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_intent_signals_platform ON public.intent_signals (platform);
CREATE INDEX IF NOT EXISTS idx_intent_signals_search ON public.intent_signals (search_query, search_city);
CREATE INDEX IF NOT EXISTS idx_intent_signals_discovered ON public.intent_signals (discovered_at DESC);

-- agent_logs.agent_id references agents(id), so the agent needs a row for its telemetry.
INSERT INTO public.agents (id, name, type, status, description, running_jobs, success_rate, total_executions, avg_latency, model, temperature, concurrency) VALUES
('agt-discovery', 'Student Discovery Agent', 'AI Agent', 'active', 'Searches public posts for people looking to learn a course in a city and scores their intent with Sarvam.', 0, 100.00, 0, '30s', 'sarvam-105b', 0.20, 1)
ON CONFLICT (id) DO NOTHING;

-- The API currently runs with the anon key (no SUPABASE_SERVICE_ROLE_KEY), so it needs write access
-- for discovery upserts and status triage.
-- TODO: revoke INSERT, UPDATE from anon and drop these policies once the service role key is set.
GRANT INSERT, UPDATE ON public.intent_signals TO anon;

DROP POLICY IF EXISTS "Allow anon insert intent signals" ON public.intent_signals;
CREATE POLICY "Allow anon insert intent signals" ON public.intent_signals
    FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon update intent signals" ON public.intent_signals;
CREATE POLICY "Allow anon update intent signals" ON public.intent_signals
    FOR UPDATE TO anon USING (true) WITH CHECK (true);
