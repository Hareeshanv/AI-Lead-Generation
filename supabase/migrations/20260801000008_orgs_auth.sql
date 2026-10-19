-- Organizations, memberships (admin | manager | member), profiles and invitations.
-- A new auth user gets a profile and either joins the org that invited them or gets their own org.
-- Idempotent: safe to re-run.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

-- 1. Tables
CREATE TABLE IF NOT EXISTS public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    full_name TEXT,
    avatar_url TEXT,
    default_org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
    notification_prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_email_lower ON public.profiles (lower(email));

CREATE TABLE IF NOT EXISTS public.org_members (
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'manager', 'member')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user ON public.org_members (user_id);

CREATE TABLE IF NOT EXISTS public.invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'manager', 'member')),
    token TEXT NOT NULL UNIQUE
        DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '14 days',
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_pending_email
    ON public.invitations (org_id, lower(email))
    WHERE status = 'pending';

DROP TRIGGER IF EXISTS trg_organizations_updated_at ON public.organizations;
CREATE TRIGGER trg_organizations_updated_at BEFORE UPDATE ON public.organizations
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_org_members_updated_at ON public.org_members;
CREATE TRIGGER trg_org_members_updated_at BEFORE UPDATE ON public.org_members
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. RLS helpers (SECURITY DEFINER so policies can call them without recursive RLS checks)
CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.org_members m
        WHERE m.org_id = p_org_id AND m.user_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.org_role(p_org_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT m.role FROM public.org_members m
    WHERE m.org_id = p_org_id AND m.user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.has_org_role(p_org_id UUID, p_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.org_members m
        WHERE m.org_id = p_org_id AND m.user_id = auth.uid() AND m.role = ANY (p_roles)
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_org_member(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.org_role(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_org_role(UUID, TEXT[]) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.is_org_member(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.org_role(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_org_role(UUID, TEXT[]) FROM anon;

-- 3. Org creation (redefined in 0013 to also create org_settings)
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

    INSERT INTO public.org_members (org_id, user_id, role)
    VALUES (v_org_id, p_owner, 'admin')
    ON CONFLICT (org_id, user_id) DO UPDATE SET role = 'admin';

    UPDATE public.profiles SET default_org_id = coalesce(default_org_id, v_org_id) WHERE id = p_owner;
    RETURN v_org_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_organization(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_organization(TEXT, UUID) TO service_role;

-- 4. Signup trigger: profile + (pending invitation membership | new org with admin membership).
--    raw_user_meta_data keys: full_name, org_name (sent by the register page).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_meta JSONB := coalesce(NEW.raw_user_meta_data, '{}'::jsonb);
    v_full_name TEXT := nullif(trim(coalesce(v_meta->>'full_name', v_meta->>'name', '')), '');
    v_joined INT := 0;
    v_first_org UUID;
BEGIN
    INSERT INTO public.profiles (id, email, full_name)
    VALUES (NEW.id, NEW.email, v_full_name)
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

    WITH accepted AS (
        UPDATE public.invitations i
        SET status = 'accepted', accepted_at = NOW()
        WHERE i.status = 'pending'
          AND i.expires_at > NOW()
          AND lower(i.email) = lower(NEW.email)
        RETURNING i.org_id, i.role
    ), inserted AS (
        INSERT INTO public.org_members (org_id, user_id, role)
        SELECT a.org_id, NEW.id, a.role FROM accepted a
        ON CONFLICT (org_id, user_id) DO NOTHING
        RETURNING org_id
    )
    SELECT count(*), min(org_id::text)::uuid INTO v_joined, v_first_org FROM inserted;

    IF v_joined > 0 THEN
        UPDATE public.profiles SET default_org_id = v_first_org WHERE id = NEW.id;
    ELSIF EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = '00000000-0000-0000-0000-000000000001')
          AND NOT EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = '00000000-0000-0000-0000-000000000001') THEN
        -- The first account claims the Default Workspace that holds pre-auth data (see 0009).
        INSERT INTO public.org_members (org_id, user_id, role)
        VALUES ('00000000-0000-0000-0000-000000000001', NEW.id, 'admin');
        UPDATE public.organizations
        SET name = coalesce(nullif(trim(coalesce(v_meta->>'org_name', '')), ''), name)
        WHERE id = '00000000-0000-0000-0000-000000000001';
        UPDATE public.profiles SET default_org_id = '00000000-0000-0000-0000-000000000001' WHERE id = NEW.id;
    ELSE
        PERFORM public.create_organization(
            coalesce(
                nullif(trim(coalesce(v_meta->>'org_name', '')), ''),
                coalesce(v_full_name, split_part(coalesce(NEW.email, ''), '@', 1), 'My') || '''s Workspace'
            ),
            NEW.id
        );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Profiles for users that signed up before this migration (memberships are backfilled in 0009).
INSERT INTO public.profiles (id, email, full_name)
SELECT u.id, u.email, nullif(trim(coalesce(u.raw_user_meta_data->>'full_name', '')), '')
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

-- 5. RLS: browsers may read their own org data; every write goes through the API (service_role).
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read organization" ON public.organizations;
CREATE POLICY "Members read organization" ON public.organizations
    FOR SELECT TO authenticated USING (public.is_org_member(id));

DROP POLICY IF EXISTS "Read own and co-member profiles" ON public.profiles;
CREATE POLICY "Read own and co-member profiles" ON public.profiles
    FOR SELECT TO authenticated USING (
        id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.org_members m
            WHERE m.user_id = profiles.id AND public.is_org_member(m.org_id)
        )
    );

DROP POLICY IF EXISTS "Members read memberships" ON public.org_members;
CREATE POLICY "Members read memberships" ON public.org_members
    FOR SELECT TO authenticated USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS "Admins read invitations" ON public.invitations;
CREATE POLICY "Admins read invitations" ON public.invitations
    FOR SELECT TO authenticated USING (public.has_org_role(org_id, ARRAY['admin']));

REVOKE ALL ON public.organizations, public.profiles, public.org_members, public.invitations FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.organizations, public.profiles, public.org_members, public.invitations
    FROM authenticated;
GRANT SELECT ON public.organizations, public.profiles, public.org_members, public.invitations TO authenticated;
GRANT ALL ON public.organizations, public.profiles, public.org_members, public.invitations TO service_role;
