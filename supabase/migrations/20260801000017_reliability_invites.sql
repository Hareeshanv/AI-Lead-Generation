-- Reliability and invitation fixes:
--   1. messages.send_started_at: a WhatsApp send is claimed before calling the provider, so a retried job never sends twice.
--   2. workflow_schedule_leads: "leads"-scoped schedule workflows run at most once per lead.
--   3. Retention helpers for finished jobs and old audit-log rows (called by the API's daily maintenance job).
--   4. Invitations to existing accounts stay pending until the invitee accepts them explicitly.
--   5. Lookup index for routing WhatsApp webhooks by phone number id.
-- Idempotent: safe to re-run.

-- 1. WhatsApp send claims
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS send_started_at TIMESTAMPTZ;

-- 2. Leads already processed by a schedule workflow
CREATE TABLE IF NOT EXISTS public.workflow_schedule_leads (
    workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    run_id UUID REFERENCES public.workflow_runs(id) ON DELETE SET NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workflow_id, lead_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_schedule_leads_org ON public.workflow_schedule_leads (org_id, workflow_id);

ALTER TABLE public.workflow_schedule_leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workflow_schedule_leads FROM anon, authenticated;
GRANT ALL ON public.workflow_schedule_leads TO service_role;

-- 3. Retention (service role only; deletes in bounded batches)
CREATE INDEX IF NOT EXISTS idx_jobs_finished ON public.jobs (updated_at)
    WHERE status IN ('succeeded', 'failed', 'cancelled');

CREATE OR REPLACE FUNCTION public.purge_finished_jobs(p_before TIMESTAMPTZ, p_limit INT DEFAULT 1000)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_deleted INT;
BEGIN
    WITH doomed AS (
        SELECT j.id FROM public.jobs j
        WHERE j.status IN ('succeeded', 'failed', 'cancelled') AND j.updated_at < p_before
        LIMIT greatest(p_limit, 0)
    )
    DELETE FROM public.jobs j USING doomed d WHERE j.id = d.id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_audit_log_created ON public.audit_log (created_at);

CREATE OR REPLACE FUNCTION public.purge_audit_log(p_before TIMESTAMPTZ, p_limit INT DEFAULT 1000)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_deleted INT;
BEGIN
    WITH doomed AS (
        SELECT a.id FROM public.audit_log a
        WHERE a.created_at < p_before
        LIMIT greatest(p_limit, 0)
    )
    DELETE FROM public.audit_log a USING doomed d WHERE a.id = d.id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_finished_jobs(TIMESTAMPTZ, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_audit_log(TIMESTAMPTZ, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_finished_jobs(TIMESTAMPTZ, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_audit_log(TIMESTAMPTZ, INT) TO service_role;

-- 4. Explicit acceptance for invitations to existing accounts.
--    Pending memberships created by the signup trigger (new accounts that followed the invite email)
--    keep requires_acceptance = false and are still accepted by the first /api/me call.
ALTER TABLE public.org_members ADD COLUMN IF NOT EXISTS requires_acceptance BOOLEAN NOT NULL DEFAULT false;

DROP FUNCTION IF EXISTS public.accept_pending_memberships(UUID);

-- p_org_id NULL: every pending membership that does not require explicit acceptance.
-- p_org_id set: that workspace's pending membership (the invitee accepted it explicitly).
CREATE OR REPLACE FUNCTION public.accept_pending_memberships(p_user UUID, p_org_id UUID DEFAULT NULL)
RETURNS TABLE (org_id UUID, role TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
    RETURN QUERY
    WITH activated AS (
        UPDATE public.org_members m
        SET status = 'active', accepted_at = NOW(), requires_acceptance = false
        WHERE m.user_id = p_user
          AND m.status = 'pending'
          AND (CASE WHEN p_org_id IS NULL THEN NOT m.requires_acceptance ELSE m.org_id = p_org_id END)
          -- Revoked or expired invitations cannot be accepted (Resend invite extends the expiry).
          AND NOT EXISTS (
              SELECT 1 FROM public.invitations x
              WHERE x.id = m.invitation_id AND (x.status IN ('revoked', 'expired') OR x.expires_at <= NOW())
          )
        RETURNING m.org_id, m.role, m.invitation_id
    ), invites AS (
        UPDATE public.invitations i
        SET status = 'accepted', accepted_at = NOW()
        FROM activated a
        WHERE i.id = a.invitation_id AND i.status = 'pending'
        RETURNING i.id
    )
    SELECT a.org_id, a.role FROM activated a;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_pending_memberships(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_pending_memberships(UUID, UUID) TO service_role;

-- 5. WhatsApp webhook routing (shared callback URL)
CREATE INDEX IF NOT EXISTS idx_integration_credentials_wa_phone
    ON public.integration_credentials ((config->>'phoneNumberId'))
    WHERE provider = 'whatsapp';
