"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Mail, Lock } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { authErrorMessage, safeNextPath, setActiveOrgId } from "@/lib/auth";
import { API_BASE_URL } from "@/services/api/http";

const LINK_ERRORS: Record<string, string> = {
  link_invalid: "That link is invalid or has expired. Request a new one.",
};

const DEV_AUTO_LOGIN = process.env.NEXT_PUBLIC_DEV_AUTO_LOGIN === "true";
let devLoginStarted = false;

function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(LINK_ERRORS[searchParams.get("error") ?? ""] ?? null);
  const [devSigningIn, setDevSigningIn] = useState(DEV_AUTO_LOGIN && !searchParams.get("manual"));

  useEffect(() => {
    // React strict mode runs effects twice in development; only the first run signs in.
    if (!devSigningIn || devLoginStarted) return;
    devLoginStarted = true;
    // If the API rejected a session issued seconds ago, stop instead of looping between /login and the app.
    const lastAttempt = Number(window.sessionStorage.getItem("leadgen.devLoginAt") || 0);
    if (Date.now() - lastAttempt < 15_000) {
      setError("Automatic sign-in failed a moment ago (is the API running and the Supabase project active?). Click \"Sign in instantly\" to try again.");
      setDevSigningIn(false);
      return;
    }
    window.sessionStorage.setItem("leadgen.devLoginAt", String(Date.now()));
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/dev/session`, { method: "POST" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error?.message || `Dev auto-login failed (${res.status}). Is the API running with DEV_AUTO_LOGIN=true?`);
        const { error: sessionError } = await getSupabase().auth.setSession({
          access_token: body.data.accessToken,
          refresh_token: body.data.refreshToken,
        });
        if (sessionError) throw sessionError;
        setActiveOrgId(body.data.orgId);
        window.location.assign(safeNextPath(searchParams.get("next")));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Dev auto-login failed.");
        setDevSigningIn(false);
      }
    })();
  }, [devSigningIn, searchParams]);

  if (devSigningIn) {
    return (
      <div className="space-y-1 text-center py-6">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Signing you in…</h1>
        <p className="text-sm text-muted-foreground">Development auto-login is on.</p>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    const { error: signInError } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
    if (signInError) {
      setError(authErrorMessage(signInError, "Sign in failed. Try again."));
      setIsSubmitting(false);
      return;
    }
    // Full navigation so middleware sees the new session cookies.
    window.location.assign(safeNextPath(searchParams.get("next")));
  };

  const startDevLogin = () => {
    window.sessionStorage.removeItem("leadgen.devLoginAt");
    devLoginStarted = false;
    setError(null);
    setDevSigningIn(true);
  };

  return (
    <>
      <div className="space-y-1 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Sign in</h1>
        <p className="text-sm text-muted-foreground">Enter your email and password to continue.</p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="login-email" className="text-xs font-medium text-foreground">
            Email
          </label>
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            icon={<Mail className="w-4 h-4" />}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="login-password" className="text-xs font-medium text-foreground">
              Password
            </label>
            <Link href="/forgot-password" className="text-xs text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            icon={<Lock className="w-4 h-4" />}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <Button type="submit" variant="primary" className="w-full" isLoading={isSubmitting}>
          Sign in
        </Button>
      </form>

      {DEV_AUTO_LOGIN && (
        <Button type="button" variant="outline" className="w-full" onClick={startDevLogin}>
          Sign in instantly (development)
        </Button>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link href="/register" className="text-primary font-medium hover:underline">
          Create account
        </Link>
      </p>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
