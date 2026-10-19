-- Core pipeline fixes: API role grants and lead de-duplication.
-- Requires 20260801000002_add_sarvam_enrichment_columns.sql to be applied first.

-- 1. Grants for the Supabase API roles
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;

-- 2. Unique lead emails (case-insensitive). Leads without a known email are stored as
--    'Not available' and are excluded. The index is only created when no duplicates exist,
--    so existing data is never deleted by this migration.
DO $$
BEGIN
    IF EXISTS (
        SELECT lower(email)
        FROM leads
        WHERE email <> 'Not available'
        GROUP BY lower(email)
        HAVING count(*) > 1
    ) THEN
        RAISE NOTICE 'Skipping idx_leads_email_lower_unique: duplicate lead emails exist. Remove duplicates and re-run this migration.';
    ELSE
        CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_email_lower_unique
            ON leads (lower(email))
            WHERE email <> 'Not available';
    END IF;
END
$$;
