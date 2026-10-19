-- Campaigns: channel, audience, lifecycle, sequence steps, per-recipient state, messages and unsubscribes.
-- Idempotent: safe to re-run.

-- 1. Campaigns
ALTER TABLE public.campaigns
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'email',
    ADD COLUMN IF NOT EXISTS audience_filter JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS send_window JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS throttle_per_hour INT NOT NULL DEFAULT 100,
    ADD COLUMN IF NOT EXISTS from_identity JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS launched_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS delivered_count INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS bounced_count INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

COMMENT ON COLUMN public.campaigns.send_window IS
    '{"start":"09:00","end":"18:00","days":[1,2,3,4,5],"timezone":"Asia/Kolkata"}; empty = any time.';
COMMENT ON COLUMN public.campaigns.from_identity IS
    'Email: {"name","email","replyTo"}. WhatsApp: {"phoneNumberId"}.';

UPDATE public.campaigns SET status = lower(status) WHERE status IS NOT NULL AND status <> lower(status);
UPDATE public.campaigns SET status = 'draft'
    WHERE status IS NULL OR status NOT IN ('draft', 'scheduled', 'active', 'paused', 'completed');
ALTER TABLE public.campaigns ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE public.campaigns ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check;
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_status_check
    CHECK (status IN ('draft', 'scheduled', 'active', 'paused', 'completed'));
ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_channel_check;
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_channel_check CHECK (channel IN ('email', 'whatsapp'));

CREATE INDEX IF NOT EXISTS idx_campaigns_org_status ON public.campaigns (org_id, status);

DROP TRIGGER IF EXISTS trg_campaigns_updated_at ON public.campaigns;
CREATE TRIGGER trg_campaigns_updated_at BEFORE UPDATE ON public.campaigns
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Steps (ordered sequence; delay is measured from the previous step)
CREATE TABLE IF NOT EXISTS public.campaign_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    position INT NOT NULL CHECK (position >= 0),
    delay_minutes INT NOT NULL DEFAULT 0 CHECK (delay_minutes >= 0),
    subject TEXT,
    body TEXT,
    whatsapp_template JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (campaign_id, position)
);

COMMENT ON COLUMN public.campaign_steps.whatsapp_template IS
    '{"name","language","components":[...]} for an approved WhatsApp Cloud template.';

-- 3. Recipients (one row per lead per campaign)
CREATE TABLE IF NOT EXISTS public.campaign_recipients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'active', 'completed', 'replied', 'bounced', 'unsubscribed', 'failed', 'skipped'
    )),
    current_step INT NOT NULL DEFAULT 0,
    next_run_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (campaign_id, lead_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_status ON public.campaign_recipients (campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_lead ON public.campaign_recipients (org_id, lead_id);

-- 4. Messages (outbound sends and inbound replies)
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
    step_id UUID REFERENCES public.campaign_steps(id) ON DELETE SET NULL,
    recipient_id UUID REFERENCES public.campaign_recipients(id) ON DELETE SET NULL,
    lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
    channel TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp')),
    direction TEXT NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound', 'inbound')),
    provider TEXT NOT NULL CHECK (provider IN ('resend', 'whatsapp')),
    provider_message_id TEXT,
    to_address TEXT,
    from_address TEXT,
    subject TEXT,
    body TEXT,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
        'queued', 'sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced', 'failed', 'received'
    )),
    status_history JSONB NOT NULL DEFAULT '[]'::jsonb,
    error TEXT,
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    opened_at TIMESTAMPTZ,
    clicked_at TIMESTAMPTZ,
    replied_at TIMESTAMPTZ,
    bounced_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_provider_id ON public.messages (provider, provider_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_campaign ON public.messages (campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_messages_lead ON public.messages (org_id, lead_id, created_at DESC);

-- 5. Unsubscribes (address is a lowercased email or an E.164 phone)
CREATE TABLE IF NOT EXISTS public.unsubscribes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    channel TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp')),
    address TEXT NOT NULL,
    lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
    reason TEXT,
    source TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unsubscribes_address ON public.unsubscribes (org_id, channel, lower(address));

DO $$
DECLARE
    v_table TEXT;
BEGIN
    FOREACH v_table IN ARRAY ARRAY['campaign_steps', 'campaign_recipients', 'messages'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || v_table || '_updated_at', v_table);
        EXECUTE format(
            'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
            'trg_' || v_table || '_updated_at', v_table
        );
    END LOOP;

    FOREACH v_table IN ARRAY ARRAY['campaign_steps', 'campaign_recipients', 'messages', 'unsubscribes'] LOOP
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
