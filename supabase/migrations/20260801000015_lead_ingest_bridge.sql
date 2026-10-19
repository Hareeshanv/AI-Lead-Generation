-- Leads inserted by the lead-webhook edge function (Meta / Google lead forms) bypass the API, so the
-- API never emitted lead.created for them. This trigger queues one "lead.ingested" job per such lead;
-- the API job handler scores the lead and emits lead.created (workflows + notifications).
-- Leads created through the API never have source_platform meta/google, so they are not double-fired.
-- Idempotent: safe to re-run.

CREATE OR REPLACE FUNCTION public.enqueue_lead_ingested()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_key TEXT := 'lead.ingested:' || NEW.id::text;
BEGIN
    IF NEW.org_id IS NULL THEN
        RETURN NEW;
    END IF;
    -- One job per lead, ever: a finished job also blocks a second enqueue.
    IF EXISTS (SELECT 1 FROM public.jobs j WHERE j.dedupe_key = v_key) THEN
        RETURN NEW;
    END IF;
    INSERT INTO public.jobs (org_id, type, payload, dedupe_key, max_attempts)
    VALUES (NEW.org_id, 'lead.ingested', jsonb_build_object('leadId', NEW.id), v_key, 5)
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running') DO NOTHING;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_lead_ingested() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_leads_enqueue_ingested ON public.leads;
CREATE TRIGGER trg_leads_enqueue_ingested
    AFTER INSERT ON public.leads
    FOR EACH ROW
    WHEN (NEW.source_platform IN ('meta', 'google'))
    EXECUTE FUNCTION public.enqueue_lead_ingested();

CREATE INDEX IF NOT EXISTS idx_jobs_dedupe_key ON public.jobs (dedupe_key) WHERE dedupe_key IS NOT NULL;
