-- Requested contact: a discovered/imported post may keep ONE phone or email, but only when the
-- author explicitly asked to be contacted and published that contact in the same text
-- (verified by the API before storage). Everything else stays redacted.
-- Idempotent: safe to re-run.

ALTER TABLE public.intent_signals ADD COLUMN IF NOT EXISTS contact_requested BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.intent_signals ADD COLUMN IF NOT EXISTS published_contact TEXT;
ALTER TABLE public.intent_signals ADD COLUMN IF NOT EXISTS contact_request_quote TEXT;
ALTER TABLE public.intent_signals ADD COLUMN IF NOT EXISTS location_match TEXT;

ALTER TABLE public.intent_signals DROP CONSTRAINT IF EXISTS intent_signals_published_contact_check;
ALTER TABLE public.intent_signals ADD CONSTRAINT intent_signals_published_contact_check
    CHECK (published_contact IS NULL OR contact_requested);

ALTER TABLE public.intent_signals DROP CONSTRAINT IF EXISTS intent_signals_location_match_check;
ALTER TABLE public.intent_signals ADD CONSTRAINT intent_signals_location_match_check
    CHECK (location_match IS NULL OR location_match IN ('exact', 'nearby', 'state'));

CREATE INDEX IF NOT EXISTS idx_intent_signals_contact_requested
    ON public.intent_signals (contact_requested DESC, intent_score DESC);

COMMENT ON TABLE public.intent_signals IS
    'Public posts showing course intent. No names. Phones/emails are redacted from all free text; '
    'published_contact holds a phone/email only when the author explicitly asked to be contacted '
    'and published it in the same post (contact_request_quote). Hard-delete rows on opt-out requests.';
COMMENT ON COLUMN public.intent_signals.published_contact IS
    'Phone/email exactly as the author published it next to an explicit contact request; NULL otherwise.';
COMMENT ON COLUMN public.intent_signals.contact_request_quote IS
    'The author''s sentence containing the contact request (max 300 chars).';

-- The API still runs with the anon key (no SUPABASE_SERVICE_ROLE_KEY), so anon needs full-row SELECT
-- and DELETE (DELETE /api/signals/:id for opt-out requests).
-- TODO: once the service role key is set, revoke SELECT/INSERT/UPDATE/DELETE from anon, drop the anon
-- policies, and grant browser roles SELECT on every column except published_contact / contact_request_quote.
GRANT SELECT ON public.intent_signals TO anon, authenticated;
GRANT DELETE ON public.intent_signals TO anon;

DROP POLICY IF EXISTS "Allow anon delete intent signals" ON public.intent_signals;
CREATE POLICY "Allow anon delete intent signals" ON public.intent_signals
    FOR DELETE TO anon USING (true);
