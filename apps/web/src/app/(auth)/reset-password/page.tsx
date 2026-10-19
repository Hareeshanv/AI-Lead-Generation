"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Lock, ArrowLeft } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/LoadingSkeleton";
import { getSupabase } from "@/lib/supabase/client";
import { authErrorMessage } from "@/lib/auth";
import { meApi } from "@/services/api";

type LinkState = "checking" | "ready" | "invalid";

/** Recovery links arrive via /auth/callback (session cookie set); invite links carry tokens in the URL hash. */
async function establishSession(code: string | null): Promise<boolean> {
  const supabase = getSupabase();
  const current = await supabase.auth.getSession();
  if (current.data.session) return true;

  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    return !error;
  }
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return !error;
  }
  return false;
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
    establishSession(searchParams.get("code"))
      .then((ok) => !cancelled && setLinkState(ok ? "ready" : "invalid"))
      .catch(() => !cancelled && setLinkState("invalid"));
    return () => {
      cancelled = true;
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
        <Link href="/forgot-password" className="block">
          <Button variant="primary" className="w-full">
            Request a new link
          </Button>
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
