"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Mail, Lock, User, Building, CheckCircle2 } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { authErrorMessage } from "@/lib/auth";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    // The database trigger creates the profile and a workspace named org_name with this user as admin.
    const { data, error: signUpError } = await getSupabase().auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: name.trim(), org_name: company.trim() },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
      },
    });
    if (signUpError) {
      setError(authErrorMessage(signUpError, "Could not create your account. Try again."));
      setIsSubmitting(false);
      return;
    }
    if (data.session) {
      window.location.assign("/dashboard");
      return;
    }
    // Email confirmation is on: no session until the link is clicked.
    setAwaitingConfirmation(true);
    setIsSubmitting(false);
  };

  if (awaitingConfirmation) {
    return (
      <>
        <div className="text-center space-y-3 py-2">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Confirm your email</h1>
          <p className="text-sm text-muted-foreground">
            We sent a confirmation link to {email}. Open it to activate your account and workspace.
          </p>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Already confirmed?{" "}
          <Link href="/login" className="text-primary font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <div className="space-y-1 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Create account</h1>
        <p className="text-sm text-muted-foreground">Set up your workspace to start collecting leads.</p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="register-name" className="text-xs font-medium text-foreground">
            Full name
          </label>
          <Input
            id="register-name"
            type="text"
            autoComplete="name"
            icon={<User className="w-4 h-4" />}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="register-email" className="text-xs font-medium text-foreground">
            Email
          </label>
          <Input
            id="register-email"
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
          <label htmlFor="register-company" className="text-xs font-medium text-foreground">
            Company
          </label>
          <Input
            id="register-company"
            type="text"
            autoComplete="organization"
            icon={<Building className="w-4 h-4" />}
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            required
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="register-password" className="text-xs font-medium text-foreground">
            Password
          </label>
          <Input
            id="register-password"
            type="password"
            autoComplete="new-password"
            icon={<Lock className="w-4 h-4" />}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
          <p className="text-[11px] text-muted-foreground">At least 8 characters.</p>
        </div>

        <Button type="submit" variant="primary" className="w-full" isLoading={isSubmitting}>
          Create account
        </Button>
      </form>

      <p className="text-center text-xs text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="text-primary font-medium hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
