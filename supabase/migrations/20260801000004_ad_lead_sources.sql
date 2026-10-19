-- Ad lead-form integration (Meta Lead Ads + Google Ads lead forms).
-- Adds academies, lead_sources (page tokens live in Supabase Vault), and ad-lead columns on leads.
-- Idempotent: safe to re-run.

CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- 1. Academies
CREATE TABLE IF NOT EXISTS public.academies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    city TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.academies (id, name, city)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Academy', 'Bengaluru')
ON CONFLICT DO NOTHING;

-- 2. Lead sources: one row per connected Meta page or Google Ads lead form webhook
CREATE TABLE IF NOT EXISTS public.lead_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    academy_id UUID REFERENCES public.academies(id) ON DELETE CASCADE
        DEFAULT '00000000-0000-0000-0000-000000000001',
    platform TEXT NOT NULL CHECK (platform IN ('meta', 'google')),
    external_page_id TEXT,
    page_name TEXT,
    form_ids TEXT[] DEFAULT '{}',
    webhook_key TEXT,
    vault_secret_id UUID,
    status TEXT DEFAULT 'active',
    last_lead_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_sources_platform_page_unique
    ON public.lead_sources (platform, external_page_id)
    WHERE external_page_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_sources_academy ON public.lead_sources (academy_id);

-- 3. Ad-lead columns on leads
ALTER TABLE public.leads
    ADD COLUMN IF NOT EXISTS academy_id UUID REFERENCES public.academies(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source_platform TEXT,
    ADD COLUMN IF NOT EXISTS external_lead_id TEXT,
    ADD COLUMN IF NOT EXISTS form_id TEXT,
    ADD COLUMN IF NOT EXISTS campaign_name TEXT,
    ADD COLUMN IF NOT EXISTS ad_name TEXT,
    ADD COLUMN IF NOT EXISTS course_interest TEXT,
    ADD COLUMN IF NOT EXISTS exam_year TEXT,
    ADD COLUMN IF NOT EXISTS is_guardian BOOLEAN,
    ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS raw_answers JSONB,
    ADD COLUMN IF NOT EXISTS needs_guardian_consent BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS scored_at TIMESTAMPTZ;

-- Lead forms often collect only a phone number. NULL emails are excluded from
-- idx_leads_email_lower_unique (NULL <> 'Not available' is not true).
ALTER TABLE public.leads ALTER COLUMN email DROP NOT NULL;

-- Webhook retries must never create duplicates. Deliberately NOT a partial index:
-- PostgREST upserts (ON CONFLICT (source_platform, external_lead_id)) cannot target a
-- partial index. NULLs are distinct in a unique index, so rows without an
-- external_lead_id (scraped leads) are unaffected, same as a WHERE ... IS NOT NULL index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_source_external_unique
    ON public.leads (source_platform, external_lead_id);

CREATE INDEX IF NOT EXISTS idx_leads_academy ON public.leads (academy_id);
CREATE INDEX IF NOT EXISTS idx_leads_source_platform ON public.leads (source_platform);

-- 4. Vault helpers for Meta page access tokens (service_role only)
CREATE OR REPLACE FUNCTION public.store_lead_source_token(p_source_id UUID, p_token TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_secret_id UUID;
    v_secret_name TEXT := 'lead_source_token_' || p_source_id::text;
BEGIN
    IF p_token IS NULL OR length(p_token) = 0 THEN
        RAISE EXCEPTION 'token must not be empty';
    END IF;

    SELECT ls.vault_secret_id INTO v_secret_id
    FROM public.lead_sources ls
    WHERE ls.id = p_source_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'lead source % not found', p_source_id;
    END IF;

    IF v_secret_id IS NULL OR NOT EXISTS (SELECT 1 FROM vault.secrets s WHERE s.id = v_secret_id) THEN
        SELECT s.id INTO v_secret_id FROM vault.secrets s WHERE s.name = v_secret_name;
    END IF;

    IF v_secret_id IS NULL THEN
        v_secret_id := vault.create_secret(p_token, v_secret_name, 'Meta page access token for lead source');
    ELSE
        PERFORM vault.update_secret(v_secret_id, p_token);
    END IF;

    UPDATE public.lead_sources SET vault_secret_id = v_secret_id WHERE id = p_source_id;

    RETURN v_secret_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_lead_source_token(p_source_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT ds.decrypted_secret
    FROM public.lead_sources ls
    JOIN vault.decrypted_secrets ds ON ds.id = ls.vault_secret_id
    WHERE ls.id = p_source_id;
$$;

CREATE OR REPLACE FUNCTION public.delete_lead_source_token(p_source_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_secret_id UUID;
BEGIN
    SELECT ls.vault_secret_id INTO v_secret_id
    FROM public.lead_sources ls
    WHERE ls.id = p_source_id;

    IF v_secret_id IS NULL THEN
        RETURN;
    END IF;

    DELETE FROM vault.secrets s WHERE s.id = v_secret_id;
    UPDATE public.lead_sources SET vault_secret_id = NULL WHERE id = p_source_id;
END;
$$;

REVOKE ALL ON FUNCTION public.store_lead_source_token(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_lead_source_token(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_lead_source_token(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_lead_source_token(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_lead_source_token(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_lead_source_token(UUID) TO service_role;

-- 5. Grants and RLS. service_role bypasses RLS. lead_sources holds webhook_key and
--    vault references, so anon/authenticated get nothing on it.
ALTER TABLE public.academies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_sources ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.academies TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_sources TO service_role;

REVOKE ALL ON public.lead_sources FROM anon, authenticated;
REVOKE ALL ON public.academies FROM anon, authenticated;
GRANT SELECT ON public.academies TO anon, authenticated;

DROP POLICY IF EXISTS "Allow read academies" ON public.academies;
CREATE POLICY "Allow read academies" ON public.academies
    FOR SELECT TO anon, authenticated USING (true);

-- 6. Realtime INSERT events on leads (new ad leads appear live in the UI)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (
           SELECT 1 FROM pg_publication_tables
           WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'leads'
       ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.leads;
    END IF;
END
$$;
