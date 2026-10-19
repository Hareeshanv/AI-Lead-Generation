-- Discovery settings, scoring inputs and performance:
--   1. org_settings.discovery: per-workspace business description, market country and search vocabulary.
--      Workspaces that exist before this migration keep the education vocabulary they were built on.
--   2. pipeline_runs.tokens_used: Sarvam tokens per discovery run.
--   3. AI scores kept as scoring inputs on existing agent leads (raw_answers.fit_score / intent_score).
--   4. Org-first indexes for runs, agent logs and intent signals; pg_trgm indexes for ilike search.
--   5. Batched lead updates (different score per row; tag add/remove) scoped to one org.
-- Idempotent: safe to re-run.

-- 1. Discovery settings
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'org_settings' AND column_name = 'discovery'
    ) THEN
        ALTER TABLE public.org_settings ADD COLUMN discovery JSONB NOT NULL DEFAULT '{}'::jsonb;
        UPDATE public.org_settings
        SET discovery = jsonb_build_object(
            'interestPreset', 'education',
            'businessDescription', 'coaching institutes and training academies'
        );
    END IF;
END;
$$;

COMMENT ON COLUMN public.org_settings.discovery IS
    'Lead discovery settings: {businessDescription, country, language, interestPreset, interests[], cities[]}; validated by the API.';

-- 2. Tokens per run (backfilled from the run's step executions)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pipeline_runs' AND column_name = 'tokens_used'
    ) THEN
        ALTER TABLE public.pipeline_runs ADD COLUMN tokens_used INTEGER NOT NULL DEFAULT 0;
        UPDATE public.pipeline_runs pr
        SET tokens_used = t.total
        FROM (
            SELECT e.pipeline_run_id, sum(coalesce(e.tokens_used, 0))::int AS total
            FROM public.agent_executions e
            GROUP BY e.pipeline_run_id
        ) t
        WHERE t.pipeline_run_id = pr.id AND t.total > 0;
    END IF;
END;
$$;

-- 3. AI scores as scoring inputs.
--    Google Maps leads stored their Sarvam fit score as the lead score; only rows never rescored since.
UPDATE public.leads l
SET raw_answers = l.raw_answers || jsonb_build_object('fit_score', l.score)
WHERE l.source_channel = 'Google Maps'
  AND l.raw_answers ? 'pipeline_run_id'
  AND NOT (l.raw_answers ? 'fit_score')
  AND l.score IS NOT NULL
  AND l.scored_at IS NOT NULL
  AND l.scored_at <= l.created_at + interval '1 minute';

--    Leads converted from intent signals take the signal's intent score.
UPDATE public.leads l
SET raw_answers = l.raw_answers || jsonb_build_object('intent_score', round(s.intent_score)::int)
FROM public.intent_signals s
WHERE l.raw_answers ? 'intent_signal_id'
  AND NOT (l.raw_answers ? 'intent_score')
  AND s.org_id = l.org_id
  AND s.id::text = l.raw_answers ->> 'intent_signal_id'
  AND s.intent_score IS NOT NULL;

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_org_status ON public.pipeline_runs (org_id, status);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_org_created ON public.pipeline_runs (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_logs_org_agent_created ON public.agent_logs (org_id, agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intent_signals_org_priority
    ON public.intent_signals (org_id, contact_requested DESC, intent_score DESC);
CREATE INDEX IF NOT EXISTS idx_intent_signals_org_discovered ON public.intent_signals (org_id, discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_intent_signals_org_status ON public.intent_signals (org_id, status);
-- Background scorer: ad-form leads without a score yet.
CREATE INDEX IF NOT EXISTS idx_leads_unscored_ad ON public.leads (created_at)
    WHERE scored_at IS NULL AND source_platform IS NOT NULL;

-- Trigram indexes for the `%term%` ilike filters used by lead list search and natural-language search.
-- Supabase installs extensions into the "extensions" schema, so the operator class is schema-qualified.
DO $$
DECLARE
    v_schema TEXT;
    v_spec TEXT[];
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
        IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
            CREATE EXTENSION pg_trgm WITH SCHEMA extensions;
        ELSE
            CREATE EXTENSION pg_trgm;
        END IF;
    END IF;
    SELECT n.nspname INTO v_schema
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_trgm';

    FOREACH v_spec SLICE 1 IN ARRAY ARRAY[
        ['leads', 'name'], ['leads', 'company'], ['leads', 'email'], ['leads', 'phone'],
        ['leads', 'title'], ['leads', 'location'], ['leads', 'industry'], ['leads', 'course_interest'],
        ['intent_signals', 'course_interest'], ['intent_signals', 'post_excerpt'], ['intent_signals', 'search_query'],
        ['intent_signals', 'city'], ['intent_signals', 'search_city']
    ] LOOP
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS %I ON public.%I USING gin (%I %I.gin_trgm_ops)',
            'idx_' || v_spec[1] || '_' || v_spec[2] || '_trgm', v_spec[1], v_spec[2], v_schema
        );
    END LOOP;
END;
$$;

-- 5. Batched lead updates (service role only; every row is matched on org_id too)

-- p_rows: [{"id": uuid, "score": int, "status": text|null, "scored_at": timestamptz|null}]
CREATE OR REPLACE FUNCTION public.update_lead_scores(p_org_id UUID, p_rows JSONB)
RETURNS SETOF public.leads
LANGUAGE sql
SET search_path = ''
AS $$
    UPDATE public.leads l
    SET score = u.score,
        status = coalesce(u.status, l.status),
        scored_at = coalesce(u.scored_at, now())
    FROM jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) AS u(id UUID, score INTEGER, status TEXT, scored_at TIMESTAMPTZ)
    WHERE l.org_id = p_org_id AND l.id = u.id AND u.score IS NOT NULL
    RETURNING l.*;
$$;

-- Existing tags then added tags, first occurrence kept, removed tags dropped.
CREATE OR REPLACE FUNCTION public.merge_lead_tags(p_current TEXT[], p_add TEXT[], p_remove TEXT[])
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT coalesce(array_agg(t.tag ORDER BY t.pos), '{}'::text[])
    FROM (
        SELECT x.tag, min(x.pos) AS pos
        FROM unnest(coalesce(p_current, '{}'::text[]) || coalesce(p_add, '{}'::text[])) WITH ORDINALITY AS x(tag, pos)
        WHERE x.tag IS NOT NULL AND NOT (x.tag = ANY (coalesce(p_remove, '{}'::text[])))
        GROUP BY x.tag
    ) t;
$$;

-- Returns only the leads whose tags changed.
CREATE OR REPLACE FUNCTION public.update_lead_tags(p_org_id UUID, p_lead_ids UUID[], p_add TEXT[], p_remove TEXT[])
RETURNS SETOF public.leads
LANGUAGE sql
SET search_path = ''
AS $$
    UPDATE public.leads l
    SET tags = public.merge_lead_tags(l.tags, p_add, p_remove)
    WHERE l.org_id = p_org_id
      AND l.id = ANY (p_lead_ids)
      AND coalesce(l.tags, '{}'::text[]) IS DISTINCT FROM public.merge_lead_tags(l.tags, p_add, p_remove)
    RETURNING l.*;
$$;

REVOKE ALL ON FUNCTION public.update_lead_scores(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_lead_tags(TEXT[], TEXT[], TEXT[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_lead_tags(UUID, UUID[], TEXT[], TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_lead_scores(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.merge_lead_tags(TEXT[], TEXT[], TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_lead_tags(UUID, UUID[], TEXT[], TEXT[]) TO service_role;
