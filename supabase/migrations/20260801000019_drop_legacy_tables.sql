-- Drops the mock-era tables from the init migration that nothing reads or writes: public.users
-- (superseded by auth.users + profiles/org_members), public.companies and public.contacts (superseded
-- by leads). No API, web, edge function, view, function or foreign key references them.
--
-- No CASCADE: if something outside this repo was built on these tables the migration fails instead of
-- silently dropping it. auth.users is a different table and is not affected.

DROP TABLE IF EXISTS public.contacts;
DROP TABLE IF EXISTS public.companies;
DROP TABLE IF EXISTS public.users;
