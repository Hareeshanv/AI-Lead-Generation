-- Scopes every business table to an organization, backfills existing rows into the
-- "Default Workspace", enables member-scoped RLS, revokes the temporary anon write grants
-- from 0006/0007 and removes the seeded demo agents.
-- Browsers only get SELECT (for Realtime); all writes go through the API with the service role.
-- Idempotent: safe to re-run.

-- 1. Default Workspace for pre-auth data. Existing auth users become its admins; otherwise the
--    first account that signs up claims it (handle_new_user in 0008).
INSERT INTO public.organizations (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Workspace')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.org_members (org_id, user_id, role)
SELECT '00000000-0000-0000-0000-000000000001', u.id, 'admin'
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.org_members m WHERE m.user_id = u.id)
ON CONFLICT (org_id, user_id) DO NOTHING;

UPDATE public.profiles p
SET default_org_id = '00000000-0000-0000-0000-000000000001'
WHERE p.default_org_id IS NULL
  AND EXISTS (
      SELECT 1 FROM public.org_members m
      WHERE m.user_id = p.id AND m.org_id = '00000000-0000-0000-0000-000000000001'
  );

-- 2. org_id columns + backfill. Tables in v_required become NOT NULL.
DO $$
DECLARE
    v_table TEXT;
    v_required TEXT[] := ARRAY['leads', 'deals', 'campaigns', 'workflows', 'intent_signals', 'pipeline_runs', 'lead_sources'];
    v_optional TEXT[] := ARRAY['agent_executions', 'agent_logs', 'academies'];
BEGIN
    FOREACH v_table IN ARRAY v_required || v_optional LOOP
        IF to_regclass('public.' || v_table) IS NULL THEN
            RAISE NOTICE 'Skipping org_id on missing table %', v_table;
            CONTINUE;
        END IF;
        EXECUTE format(
            'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE',
            v_table
        );
        EXECUTE format(
            'UPDATE public.%I SET org_id = %L WHERE org_id IS NULL',
            v_table, '00000000-0000-0000-0000-000000000001'
        );
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (org_id)', 'idx_' || v_table || '_org', v_table);
        IF v_table = ANY (v_required) THEN
            EXECUTE format('ALTER TABLE public.%I ALTER COLUMN org_id SET NOT NULL', v_table);
        END IF;
    END LOOP;
END
$$;

-- Webhook leads carry academy_id; fill org_id from the academy when the writer did not set it
-- (keeps an older deployed lead-webhook function working).
CREATE OR REPLACE FUNCTION public.leads_fill_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.org_id IS NULL AND NEW.academy_id IS NOT NULL THEN
        SELECT a.org_id INTO NEW.org_id FROM public.academies a WHERE a.id = NEW.academy_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_fill_org_id ON public.leads;
CREATE TRIGGER trg_leads_fill_org_id BEFORE INSERT ON public.leads
    FOR EACH ROW EXECUTE FUNCTION public.leads_fill_org_id();

CREATE OR REPLACE FUNCTION public.agent_executions_fill_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.org_id IS NULL AND NEW.pipeline_run_id IS NOT NULL THEN
        SELECT r.org_id INTO NEW.org_id FROM public.pipeline_runs r WHERE r.id = NEW.pipeline_run_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_executions_fill_org_id ON public.agent_executions;
CREATE TRIGGER trg_agent_executions_fill_org_id BEFORE INSERT ON public.agent_executions
    FOR EACH ROW EXECUTE FUNCTION public.agent_executions_fill_org_id();

-- 3. Uniqueness becomes per org.
ALTER TABLE public.intent_signals DROP CONSTRAINT IF EXISTS intent_signals_post_url_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_intent_signals_org_post_url ON public.intent_signals (org_id, post_url);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.leads
        WHERE email IS NOT NULL AND email <> 'Not available'
        GROUP BY org_id, lower(email)
        HAVING count(*) > 1
    ) THEN
        RAISE NOTICE 'Skipping idx_leads_org_email_lower_unique: duplicate lead emails exist within an org.';
    ELSE
        DROP INDEX IF EXISTS public.idx_leads_email_lower_unique;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_org_email_lower_unique
            ON public.leads (org_id, lower(email))
            WHERE email <> 'Not available';
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_leads_org_created ON public.leads (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_org_stage ON public.deals (org_id, stage);

-- 4. Demo agents. agent_logs keeps free-form agent ids (webhook and discovery telemetry).
ALTER TABLE public.agent_logs DROP CONSTRAINT IF EXISTS agent_logs_agent_id_fkey;
DELETE FROM public.agents WHERE id <> 'agt-discovery';

-- 5. Drop the permissive and anon policies from earlier migrations.
DROP POLICY IF EXISTS "Allow all pipeline_runs access" ON public.pipeline_runs;
DROP POLICY IF EXISTS "Allow all agent_executions access" ON public.agent_executions;
DROP POLICY IF EXISTS "Allow read intent signals" ON public.intent_signals;
DROP POLICY IF EXISTS "Allow anon insert intent signals" ON public.intent_signals;
DROP POLICY IF EXISTS "Allow anon update intent signals" ON public.intent_signals;
DROP POLICY IF EXISTS "Allow anon delete intent signals" ON public.intent_signals;
DROP POLICY IF EXISTS "Allow read academies" ON public.academies;

-- 6. RLS on every public table; org members may read their org's rows.
DO $$
DECLARE
    v_table TEXT;
    v_scoped TEXT[] := ARRAY[
        'leads', 'deals', 'campaigns', 'workflows', 'intent_signals', 'pipeline_runs',
        'agent_executions', 'agent_logs', 'academies'
    ];
BEGIN
    FOR v_table IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    END LOOP;

    FOREACH v_table IN ARRAY v_scoped LOOP
        IF to_regclass('public.' || v_table) IS NULL THEN CONTINUE; END IF;
        EXECUTE format('DROP POLICY IF EXISTS "Org members read" ON public.%I', v_table);
        EXECUTE format(
            'CREATE POLICY "Org members read" ON public.%I FOR SELECT TO authenticated USING (public.is_org_member(org_id))',
            v_table
        );
    END LOOP;
END
$$;

-- The agents catalog is global and read-only.
DROP POLICY IF EXISTS "Authenticated read agents" ON public.agents;
CREATE POLICY "Authenticated read agents" ON public.agents FOR SELECT TO authenticated USING (true);

-- 7. Grants: anon gets nothing; authenticated gets SELECT only (RLS-filtered); service_role everything.
--    Tables created by later migrations repeat this for themselves.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
REVOKE SELECT ON public.lead_sources FROM authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
