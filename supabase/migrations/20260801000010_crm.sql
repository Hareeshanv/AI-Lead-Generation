-- CRM: deal <-> lead linkage, owners, follow-ups, plus activities (timeline) and tasks.
-- Idempotent: safe to re-run.

-- 1. Deals
ALTER TABLE public.deals
    ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS next_follow_up_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS lost_reason TEXT,
    ADD COLUMN IF NOT EXISTS position DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_deals_lead ON public.deals (lead_id);
CREATE INDEX IF NOT EXISTS idx_deals_owner ON public.deals (org_id, owner_id);
CREATE INDEX IF NOT EXISTS idx_deals_follow_up ON public.deals (org_id, next_follow_up_at)
    WHERE next_follow_up_at IS NOT NULL;

DROP TRIGGER IF EXISTS trg_deals_updated_at ON public.deals;
CREATE TRIGGER trg_deals_updated_at BEFORE UPDATE ON public.deals
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Leads
ALTER TABLE public.leads
    ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS stage TEXT,
    ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS do_not_contact BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS consent_channel TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.leads.consent_channel IS
    'Channels the lead consented to be contacted on (email, whatsapp, sms, call).';

CREATE INDEX IF NOT EXISTS idx_leads_owner ON public.leads (org_id, owner_id);
CREATE INDEX IF NOT EXISTS idx_leads_org_status ON public.leads (org_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_org_score ON public.leads (org_id, score DESC);

DROP TRIGGER IF EXISTS trg_leads_updated_at ON public.leads;
CREATE TRIGGER trg_leads_updated_at BEFORE UPDATE ON public.leads
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Activities (timeline entries for a lead and/or deal)
CREATE TABLE IF NOT EXISTS public.activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
    deal_id UUID REFERENCES public.deals(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN (
        'note', 'call', 'email', 'whatsapp', 'meeting', 'stage_change', 'status_change',
        'task', 'campaign', 'workflow', 'agent', 'system'
    )),
    title TEXT,
    body TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activities_lead ON public.activities (org_id, lead_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_deal ON public.activities (org_id, deal_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_org_time ON public.activities (org_id, occurred_at DESC);

-- 4. Tasks (follow-ups)
CREATE TABLE IF NOT EXISTS public.tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
    deal_id UUID REFERENCES public.deals(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    description TEXT,
    due_at TIMESTAMPTZ,
    assignee_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
    completed_at TIMESTAMPTZ,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_lead ON public.tasks (org_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_tasks_deal ON public.tasks (org_id, deal_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_due ON public.tasks (org_id, assignee_id, status, due_at);

DROP TRIGGER IF EXISTS trg_tasks_updated_at ON public.tasks;
CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. RLS + grants
DO $$
DECLARE
    v_table TEXT;
BEGIN
    FOREACH v_table IN ARRAY ARRAY['activities', 'tasks'] LOOP
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
