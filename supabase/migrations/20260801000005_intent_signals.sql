-- Intent signals: public posts (forums, Q&A sites, social) showing course intent, imported
-- from the Sarvam platform agent. Deliberately has NO name / phone / email columns; the
-- import API also redacts contact details from free text.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.intent_signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_url TEXT NOT NULL UNIQUE,
    source_channel TEXT,
    post_excerpt TEXT,
    post_date TEXT,
    city TEXT,
    course_interest TEXT,
    urgency TEXT,
    budget TEXT,
    intent_score NUMERIC,
    lead_routing_category TEXT,
    suggested_public_reply TEXT,
    status TEXT NOT NULL DEFAULT 'new'
        CONSTRAINT intent_signals_status_check CHECK (status IN ('new', 'replied', 'routed', 'dismissed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intent_signals_city ON public.intent_signals (city);
CREATE INDEX IF NOT EXISTS idx_intent_signals_course ON public.intent_signals (course_interest);
CREATE INDEX IF NOT EXISTS idx_intent_signals_status ON public.intent_signals (status);

CREATE OR REPLACE FUNCTION public.set_intent_signals_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_intent_signals_updated_at ON public.intent_signals;
CREATE TRIGGER trg_intent_signals_updated_at
    BEFORE UPDATE ON public.intent_signals
    FOR EACH ROW EXECUTE FUNCTION public.set_intent_signals_updated_at();

-- Grants and RLS: the API writes with service_role (bypasses RLS); clients may only read.
ALTER TABLE public.intent_signals ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.intent_signals TO service_role;
REVOKE ALL ON public.intent_signals FROM anon, authenticated;
GRANT SELECT ON public.intent_signals TO anon, authenticated;

DROP POLICY IF EXISTS "Allow read intent signals" ON public.intent_signals;
CREATE POLICY "Allow read intent signals" ON public.intent_signals
    FOR SELECT TO anon, authenticated USING (true);
