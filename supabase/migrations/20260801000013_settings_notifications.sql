-- Org settings, Vault-backed integration credentials, per-user notifications and the audit log.
-- Idempotent: safe to re-run.

CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- 1. Org settings (one row per org)
CREATE TABLE IF NOT EXISTS public.org_settings (
    org_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    currency TEXT NOT NULL DEFAULT 'INR' CHECK (currency ~ '^[A-Z]{3}$'),
    timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    locale TEXT NOT NULL DEFAULT 'en-IN',
    scoring JSONB NOT NULL DEFAULT '{"hot": 80, "warm": 50}'::jsonb,
    default_owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    branding JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN public.org_settings.scoring IS
    'Lead score thresholds: score >= hot is Hot, >= warm is Warm, otherwise Cold.';

DROP TRIGGER IF EXISTS trg_org_settings_updated_at ON public.org_settings;
CREATE TRIGGER trg_org_settings_updated_at BEFORE UPDATE ON public.org_settings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.org_settings (org_id)
SELECT o.id FROM public.organizations o
ON CONFLICT (org_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_organization(p_name TEXT, p_owner UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_org_id UUID;
BEGIN
    INSERT INTO public.organizations (name, created_by)
    VALUES (coalesce(nullif(trim(p_name), ''), 'My Workspace'), p_owner)
    RETURNING id INTO v_org_id;

    INSERT INTO public.org_settings (org_id) VALUES (v_org_id) ON CONFLICT (org_id) DO NOTHING;

    INSERT INTO public.org_members (org_id, user_id, role)
    VALUES (v_org_id, p_owner, 'admin')
    ON CONFLICT (org_id, user_id) DO UPDATE SET role = 'admin';

    UPDATE public.profiles SET default_org_id = coalesce(default_org_id, v_org_id) WHERE id = p_owner;
    RETURN v_org_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_organization(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_organization(TEXT, UUID) TO service_role;

-- 2. Integration credentials. Secrets live in Vault as one JSON string per (org, provider);
--    config holds non-secret settings (from address, phone number id, ...).
CREATE TABLE IF NOT EXISTS public.integration_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('resend', 'whatsapp', 'serper', 'sarvam', 'meta', 'slack', 'webhook')),
    vault_secret_id UUID,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'not_configured' CHECK (status IN ('connected', 'not_configured', 'error')),
    last_checked_at TIMESTAMPTZ,
    last_error TEXT,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, provider)
);

DROP TRIGGER IF EXISTS trg_integration_credentials_updated_at ON public.integration_credentials;
CREATE TRIGGER trg_integration_credentials_updated_at BEFORE UPDATE ON public.integration_credentials
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.store_integration_secret(p_org_id UUID, p_provider TEXT, p_secret TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_secret_id UUID;
    v_secret_name TEXT := 'integration_' || p_org_id::text || '_' || p_provider;
BEGIN
    IF p_secret IS NULL OR length(p_secret) = 0 THEN
        RAISE EXCEPTION 'secret must not be empty';
    END IF;

    INSERT INTO public.integration_credentials (org_id, provider)
    VALUES (p_org_id, p_provider)
    ON CONFLICT (org_id, provider) DO NOTHING;

    SELECT c.vault_secret_id INTO v_secret_id
    FROM public.integration_credentials c
    WHERE c.org_id = p_org_id AND c.provider = p_provider;

    IF v_secret_id IS NULL OR NOT EXISTS (SELECT 1 FROM vault.secrets s WHERE s.id = v_secret_id) THEN
        SELECT s.id INTO v_secret_id FROM vault.secrets s WHERE s.name = v_secret_name;
    END IF;

    IF v_secret_id IS NULL THEN
        v_secret_id := vault.create_secret(p_secret, v_secret_name, 'Integration credentials');
    ELSE
        PERFORM vault.update_secret(v_secret_id, p_secret);
    END IF;

    UPDATE public.integration_credentials
    SET vault_secret_id = v_secret_id
    WHERE org_id = p_org_id AND provider = p_provider;

    RETURN v_secret_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_integration_secret(p_org_id UUID, p_provider TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT ds.decrypted_secret
    FROM public.integration_credentials c
    JOIN vault.decrypted_secrets ds ON ds.id = c.vault_secret_id
    WHERE c.org_id = p_org_id AND c.provider = p_provider;
$$;

CREATE OR REPLACE FUNCTION public.delete_integration_secret(p_org_id UUID, p_provider TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_secret_id UUID;
BEGIN
    SELECT c.vault_secret_id INTO v_secret_id
    FROM public.integration_credentials c
    WHERE c.org_id = p_org_id AND c.provider = p_provider;

    IF v_secret_id IS NOT NULL THEN
        DELETE FROM vault.secrets s WHERE s.id = v_secret_id;
    END IF;

    UPDATE public.integration_credentials
    SET vault_secret_id = NULL, status = 'not_configured', last_error = NULL
    WHERE org_id = p_org_id AND provider = p_provider;
END;
$$;

REVOKE ALL ON FUNCTION public.store_integration_secret(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_integration_secret(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_integration_secret(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_integration_secret(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_integration_secret(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_integration_secret(UUID, TEXT) TO service_role;

-- 3. Notifications (per user, per org)
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'system' CHECK (type IN ('lead', 'deal', 'campaign', 'agent', 'workflow', 'integration', 'task', 'system')),
    title TEXT NOT NULL,
    body TEXT,
    link TEXT,
    entity_type TEXT,
    entity_id TEXT,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications (user_id, org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications (user_id, org_id) WHERE read_at IS NULL;

-- 4. Audit log
CREATE TABLE IF NOT EXISTS public.audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_org ON public.audit_log (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON public.audit_log (org_id, entity_type, entity_id);

-- 5. RLS + grants
ALTER TABLE public.org_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members read" ON public.org_settings;
CREATE POLICY "Org members read" ON public.org_settings
    FOR SELECT TO authenticated USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS "Org members read" ON public.integration_credentials;
CREATE POLICY "Org members read" ON public.integration_credentials
    FOR SELECT TO authenticated USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS "Users read own notifications" ON public.notifications;
CREATE POLICY "Users read own notifications" ON public.notifications
    FOR SELECT TO authenticated USING (user_id = auth.uid() AND public.is_org_member(org_id));

DROP POLICY IF EXISTS "Admins read audit log" ON public.audit_log;
CREATE POLICY "Admins read audit log" ON public.audit_log
    FOR SELECT TO authenticated USING (public.has_org_role(org_id, ARRAY['admin']));

REVOKE ALL ON public.org_settings, public.integration_credentials, public.notifications, public.audit_log FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
    ON public.org_settings, public.integration_credentials, public.notifications, public.audit_log FROM authenticated;
GRANT SELECT ON public.org_settings, public.notifications, public.audit_log TO authenticated;
-- vault_secret_id is an internal reference; browsers only see status columns.
REVOKE SELECT ON public.integration_credentials FROM authenticated;
GRANT SELECT (id, org_id, provider, config, status, last_checked_at, last_error, created_at, updated_at)
    ON public.integration_credentials TO authenticated;
GRANT ALL ON public.org_settings, public.integration_credentials, public.notifications, public.audit_log TO service_role;

-- 6. Realtime for unread counts
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (
           SELECT 1 FROM pg_publication_tables
           WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
       ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    END IF;
END
$$;
