"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Lock, ArrowLeft } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/LoadingSkeleton";
import { getSupabase } from "@/lib/supabase/client";
import { authErrorMessage } from "@/lib/auth";
import { meApi } from "@/services/api";

type LinkState = "checking" | "ready" | "invalid";

/** Session `amr` methods Supabase records when the user signed in through a recovery or invite link. */
const LINK_AUTH_METHODS = new Set(["recovery", "invite"]);
/** A link session can only set a password this long after the link was opened. */
const LINK_SESSION_MAX_AGE_S = 60 * 60;

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

/** True only for sessions created by a recent recovery/invite link, not an ordinary sign-in. */
function isLinkSession(accessToken: string): boolean {
  const amr = decodeJwtPayload(accessToken)?.amr;
  if (!Array.isArray(amr)) return false;
  const nowS = Date.now() / 1000;
  return amr.some(
    (entry) =>
      entry &&
      LINK_AUTH_METHODS.has(String(entry.method)) &&
      typeof entry.timestamp === "number" &&
      nowS - entry.timestamp < LINK_SESSION_MAX_AGE_S
  );
}

/**
 * Recovery links arrive via /auth/callback (session cookie set); invite links carry tokens in the URL hash.
 * An existing ordinary session is not enough: changing the password here needs a recovery/invite session.
 */
async function establishLinkSession(code: string | null): Promise<boolean> {
  const supabase = getSupabase();

  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (accessToken && refreshToken) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (!LINK_AUTH_METHODS.has(hash.get("type") ?? "")) return false;
    const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (error) return false;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return false;
  }

  const { data } = await supabase.auth.getSession();
  return Boolean(data.session && isLinkSession(data.session.access_token));
}

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const invited = searchParams.get("invited") === "1";
  const [linkState, setLinkState] = useState<LinkState>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Implicit-flow recovery links are consumed by supabase-js itself, which then emits PASSWORD_RECOVERY.
    const { data: subscription } = getSupabase().auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" && !cancelled) setLinkState("ready");
    });
    establishLinkSession(searchParams.get("code"))
      .then((ok) => !cancelled && setLinkState((prev) => (ok || prev === "ready" ? "ready" : "invalid")))
      .catch(() => !cancelled && setLinkState((prev) => (prev === "ready" ? "ready" : "invalid")));
    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    const { error: updateError } = await getSupabase().auth.updateUser({ password });
    if (updateError) {
      setError(authErrorMessage(updateError, "Could not update your password. Try again."));
      setIsSubmitting(false);
      return;
    }
    // GET /api/me accepts pending workspace invitations; the dashboard would also do it on first load.
    await meApi.get().catch(() => undefined);
    window.location.assign("/dashboard");
  };

  if (linkState === "checking") return <Spinner label="Checking your link…" />;

  if (linkState === "invalid") {
    return (
      <>
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Link expired</h1>
          <p className="text-sm text-muted-foreground">
            This link is invalid or has already been used. Request a new one to continue.
          </p>
        </div>
        <Link href="/forgot-password" className={buttonClassName({ className: "w-full" })}>
          Request a new link
        </Link>
        <div className="text-center">
          <Link href="/login" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="space-y-1 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {invited ? "Set your password" : "Choose a new password"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {invited ? "Finish joining your team's workspace." : "Use at least 8 characters."}
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="new-password" className="text-xs font-medium text-foreground">
            New password
          </label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            icon={<Lock className="w-4 h-4" />}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="confirm-password" className="text-xs font-medium text-foreground">
            Confirm password
          </label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            icon={<Lock className="w-4 h-4" />}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            minLength={8}
            required
          />
        </div>
        <Button type="submit" variant="primary" className="w-full" isLoading={isSubmitting}>
          {invited ? "Set password and continue" : "Update password"}
        </Button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
