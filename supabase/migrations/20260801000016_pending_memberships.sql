-- Invited users stay "pending" until they accept (first authenticated /api/me call or finishing the
-- set-password page). Pending members have no access (RLS helpers and the API only count active
-- memberships) and cannot be assigned as owners. Self sign-ups that match an invitation still join
-- immediately, as before.
-- Idempotent: safe to re-run.

-- 1. Membership status
ALTER TABLE public.org_members
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS invitation_id UUID REFERENCES public.invitations(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_members_status_check') THEN
        ALTER TABLE public.org_members
            ADD CONSTRAINT org_members_status_check CHECK (status IN ('active', 'pending'));
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_org_members_pending ON public.org_members (user_id) WHERE status = 'pending';

-- 2. RLS helpers: only active memberships grant access
CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.org_members m
        WHERE m.org_id = p_org_id AND m.user_id = auth.uid() AND m.status = 'active'
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
    WHERE m.org_id = p_org_id AND m.user_id = auth.uid() AND m.status = 'active';
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
        WHERE m.org_id = p_org_id AND m.user_id = auth.uid() AND m.role = ANY (p_roles) AND m.status = 'active'
    );
$$;

-- 3. Signup trigger. Users created by the API's invite (raw_user_meta_data.invited_org_id) get pending
--    memberships and their invitations stay pending until accepted; everyone else behaves as in 0008.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_meta JSONB := coalesce(NEW.raw_user_meta_data, '{}'::jsonb);
    v_full_name TEXT := nullif(trim(coalesce(v_meta->>'full_name', v_meta->>'name', '')), '');
    v_invited BOOLEAN := nullif(v_meta->>'invited_org_id', '') IS NOT NULL;
    v_joined INT := 0;
    v_first_org UUID;
BEGIN
    INSERT INTO public.profiles (id, email, full_name)
    VALUES (NEW.id, NEW.email, v_full_name)
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

    IF v_invited THEN
        WITH inserted AS (
            INSERT INTO public.org_members (org_id, user_id, role, status, invitation_id)
            SELECT i.org_id, NEW.id, i.role, 'pending', i.id
            FROM public.invitations i
            WHERE i.status = 'pending'
              AND i.expires_at > NOW()
              AND lower(i.email) = lower(NEW.email)
            ON CONFLICT (org_id, user_id) DO NOTHING
            RETURNING org_id
        )
        SELECT count(*), min(org_id::text)::uuid INTO v_joined, v_first_org FROM inserted;
        IF v_joined > 0 THEN
            UPDATE public.profiles SET default_org_id = v_first_org WHERE id = NEW.id;
            RETURN NEW;
        END IF;
    END IF;

    WITH accepted AS (
        UPDATE public.invitations i
        SET status = 'accepted', accepted_at = NOW()
        WHERE i.status = 'pending'
          AND i.expires_at > NOW()
          AND lower(i.email) = lower(NEW.email)
        RETURNING i.id, i.org_id, i.role
    ), inserted AS (
        INSERT INTO public.org_members (org_id, user_id, role, status, invitation_id, accepted_at)
        SELECT a.org_id, NEW.id, a.role, 'active', a.id, NOW() FROM accepted a
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

-- 4. Acceptance: activates every pending membership of a user and marks the invitations accepted.
CREATE OR REPLACE FUNCTION public.accept_pending_memberships(p_user UUID)
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
        SET status = 'active', accepted_at = NOW()
        WHERE m.user_id = p_user
          AND m.status = 'pending'
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

REVOKE ALL ON FUNCTION public.accept_pending_memberships(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_pending_memberships(UUID) TO service_role;
