"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Users } from "lucide-react";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/LoadingSkeleton";
import { getSupabase } from "@/lib/supabase/client";
import { switchWorkspace } from "@/lib/auth";
import { meApi } from "@/services/api";
import { ApiError } from "@/services/api/http";
import type { PendingInvite } from "@/types";

type PageState =
  | { kind: "checking" }
  | { kind: "missing-token" }
  | { kind: "link-expired" }
  | { kind: "signed-out" }
  | { kind: "ready"; email: string | null; invite: PendingInvite | null };

/**
 * The invitation email is a Supabase magic link: the session arrives as tokens in the URL hash
 * (or a PKCE `code`). Without either, an existing signed-in session is used.
 */
async function establishSession(code: string | null): Promise<"ok" | "expired" | "none"> {
  const supabase = getSupabase();
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  const linkError = hash.get("error_code") || hash.get("error");

  if (accessToken || linkError) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (error) return "expired";
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return "expired";
  }

  const { data } = await supabase.auth.getSession();
  if (data.session) return "ok";
  return linkError ? "expired" : "none";
}

function acceptErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 404) {
    return "This invitation has expired, was revoked, or was already accepted. Ask a workspace admin to invite you again.";
  }
  return err instanceof Error ? err.message : "Could not accept the invitation. Try again.";
}

function AcceptInvitation() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [state, setState] = useState<PageState>({ kind: "checking" });
  const [isAccepting, setIsAccepting] = useState(false);
  const [error, setError] = useState<{ message: string; wrongAccount: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setState({ kind: "missing-token" });
      return;
    }
    (async () => {
      const session = await establishSession(searchParams.get("code")).catch(() => "expired" as const);
      if (cancelled) return;
      if (session !== "ok") {
        setState({ kind: session === "expired" ? "link-expired" : "signed-out" });
        return;
      }
      const { data } = await getSupabase().auth.getUser();
      // Best effort: name the workspace when the invitation is unambiguous.
      const invites = await meApi.invitations().catch(() => [] as PendingInvite[]);
      if (!cancelled) setState({ kind: "ready", email: data.user?.email ?? null, invite: invites.length === 1 ? invites[0] : null });
    })();
    return () => {
      cancelled = true;
    };
  }, [token, searchParams]);

  const returnPath = token ? `/invitations/accept?token=${encodeURIComponent(token)}` : "/invitations/accept";
  const loginHref = `/login?next=${encodeURIComponent(returnPath)}`;

  const handleAccept = async () => {
    if (!token) return;
    setIsAccepting(true);
    setError(null);
    try {
      const me = await meApi.acceptInvitation(token);
      switchWorkspace(me.organization.id);
    } catch (err) {
      setError({ message: acceptErrorMessage(err), wrongAccount: err instanceof ApiError && err.status === 403 });
      setIsAccepting(false);
    }
  };

  const handleSwitchAccount = async () => {
    await getSupabase().auth.signOut().catch(() => undefined);
    window.location.assign(`${loginHref}&manual=1`);
  };

  if (state.kind === "checking") return <Spinner label="Checking your invitation…" />;

  if (state.kind !== "ready") {
    const copy = {
      "missing-token": { title: "Invitation link incomplete", body: "Open the link from your invitation email again." },
      "link-expired": {
        title: "Sign-in link expired",
        body: "The sign-in part of this link has expired. Sign in with your password to accept the invitation.",
      },
      "signed-out": { title: "Sign in to accept", body: "Sign in with the email address the invitation was sent to." },
    }[state.kind];
    return (
      <>
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{copy.title}</h1>
          <p className="text-sm text-muted-foreground">{copy.body}</p>
        </div>
        {state.kind !== "missing-token" && (
          <Link href={`${loginHref}&manual=1`} className={buttonClassName({ className: "w-full" })}>
            Sign in
          </Link>
        )}
        <div className="text-center">
          <Link href="/dashboard" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-3.5 h-3.5" /> Go to your dashboard
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="space-y-2 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Users className="h-5 w-5" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {state.invite ? `Join ${state.invite.orgName}` : "Join the workspace"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {state.invite ? `You've been invited as ${state.invite.role}. ` : "You've been invited to a workspace. "}
          {state.email && (
            <>
              Signed in as <span className="font-medium text-foreground">{state.email}</span>.
            </>
          )}
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error.message}
        </p>
      )}

      {error?.wrongAccount ? (
        <Button variant="primary" className="w-full" onClick={() => void handleSwitchAccount()}>
          Sign in with a different account
        </Button>
      ) : (
        <Button variant="primary" className="w-full" onClick={() => void handleAccept()} isLoading={isAccepting}>
          Accept invitation
        </Button>
      )}
      <div className="text-center">
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-3.5 h-3.5" /> Not now
        </Link>
      </div>
    </>
  );
}

export default function AcceptInvitationPage() {
  return (
    <Suspense>
      <AcceptInvitation />
    </Suspense>
  );
}
