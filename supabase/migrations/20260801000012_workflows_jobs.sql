-- Workflow definitions (trigger / conditions / actions), run history, and a DB-backed job queue.
-- Idempotent: safe to re-run.

-- 1. Workflows
ALTER TABLE public.workflows
    ADD COLUMN IF NOT EXISTS trigger JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS conditions JSONB NOT NULL DEFAULT '{"op":"and","rules":[]}'::jsonb,
    ADD COLUMN IF NOT EXISTS actions JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

COMMENT ON COLUMN public.workflows.trigger IS
    '{"type":"lead.created"|"lead.status_changed"|"lead.score_above"|"deal.stage_changed"|"campaign.replied"|"agent.run_completed"|"schedule", ...params}';
COMMENT ON COLUMN public.workflows.conditions IS
    '{"op":"and"|"or","rules":[{"field","operator","value"} | nested group]}';
COMMENT ON COLUMN public.workflows.actions IS
    'Ordered [{"type","params"}]; types include assign_owner, set_status, set_stage, add_tag, create_task, create_deal, add_to_campaign, notify, slack, webhook, delay.';

CREATE INDEX IF NOT EXISTS idx_workflows_org_enabled ON public.workflows (org_id, enabled);

DROP TRIGGER IF EXISTS trg_workflows_updated_at ON public.workflows;
CREATE TRIGGER trg_workflows_updated_at BEFORE UPDATE ON public.workflows
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Runs and steps
CREATE TABLE IF NOT EXISTS public.workflow_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    trigger_event TEXT,
    trigger_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
    deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'waiting', 'succeeded', 'failed', 'skipped')),
    dry_run BOOLEAN NOT NULL DEFAULT false,
    error TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON public.workflow_runs (workflow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_org ON public.workflow_runs (org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.workflow_run_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    run_id UUID NOT NULL REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
    position INT NOT NULL,
    action_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'waiting', 'succeeded', 'failed', 'skipped')),
    input JSONB NOT NULL DEFAULT '{}'::jsonb,
    output JSONB,
    error TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_run_steps_run ON public.workflow_run_steps (run_id, position);

-- 3. Jobs queue (service role only; claimed with FOR UPDATE SKIP LOCKED)
CREATE TABLE IF NOT EXISTS public.jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5,
    locked_at TIMESTAMPTZ,
    locked_by TEXT,
    last_error TEXT,
    dedupe_key TEXT,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_ready ON public.jobs (run_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_jobs_running ON public.jobs (locked_at) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_jobs_org_type ON public.jobs (org_id, type, status);
-- An unfinished job with the same dedupe_key blocks a duplicate enqueue.
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_dedupe_active ON public.jobs (dedupe_key)
    WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running');

DROP TRIGGER IF EXISTS trg_jobs_updated_at ON public.jobs;
CREATE TRIGGER trg_jobs_updated_at BEFORE UPDATE ON public.jobs
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Claims up to p_limit due jobs (plus running jobs whose lock is older than p_lock_timeout_seconds,
-- i.e. a crashed worker) and marks them running.
CREATE OR REPLACE FUNCTION public.claim_jobs(
    p_worker TEXT,
    p_limit INT DEFAULT 10,
    p_lock_timeout_seconds INT DEFAULT 300,
    p_types TEXT[] DEFAULT NULL
)
RETURNS SETOF public.jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    UPDATE public.jobs j
    SET status = 'running',
        locked_at = NOW(),
        locked_by = p_worker,
        attempts = j.attempts + 1
    WHERE j.id IN (
        SELECT c.id FROM public.jobs c
        WHERE (
            (c.status = 'queued' AND c.run_at <= NOW())
            OR (c.status = 'running' AND c.locked_at < NOW() - make_interval(secs => p_lock_timeout_seconds))
        )
        AND (p_types IS NULL OR c.type = ANY (p_types))
        ORDER BY c.run_at
        LIMIT greatest(p_limit, 0)
        FOR UPDATE SKIP LOCKED
    )
    RETURNING j.*;
$$;

REVOKE ALL ON FUNCTION public.claim_jobs(TEXT, INT, INT, TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_jobs(TEXT, INT, INT, TEXT[]) TO service_role;

-- 4. RLS + grants
DO $$
DECLARE
    v_table TEXT;
BEGIN
    FOREACH v_table IN ARRAY ARRAY['workflow_runs', 'workflow_run_steps'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
        EXECUTE format('DROP POLICY IF EXISTS "Org members read" ON public.%I', v_table);
        EXECUTE format(
            'CREATE POLICY "Org members read" ON public.%I FOR SELECT TO authenticated USING (public.is_org_member(org_id))',
            v_table
        );
        EXECUTE format('REVOKE ALL ON public.%I FROM anon', v_table);
        EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM authenticated', v_table);
        EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v_table);
        EXECUTE format('GRANT ALL ON public.%I TO service_role', v_table);
    END LOOP;
END
$$;

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jobs FROM anon, authenticated;
GRANT ALL ON public.jobs TO service_role;
