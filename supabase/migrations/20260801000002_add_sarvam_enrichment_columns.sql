-- Migration to add enrichment tracking columns to leads table
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS verified_email TEXT,
ADD COLUMN IF NOT EXISTS estimated_email TEXT,
ADD COLUMN IF NOT EXISTS email_confidence TEXT,
ADD COLUMN IF NOT EXISTS phone_confidence TEXT,
ADD COLUMN IF NOT EXISTS profile_url TEXT,
ADD COLUMN IF NOT EXISTS verified_email_source TEXT,
ADD COLUMN IF NOT EXISTS estimated_email_source TEXT,
ADD COLUMN IF NOT EXISTS phone_source TEXT,
ADD COLUMN IF NOT EXISTS profile_url_source TEXT,
ADD COLUMN IF NOT EXISTS industry_source TEXT,
ADD COLUMN IF NOT EXISTS source_channel TEXT;
