"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Mail, ArrowLeft, CheckCircle2 } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md glass-panel p-8 rounded-2xl border border-white/10 shadow-2xl space-y-6">
        {!submitted ? (
          <>
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold text-foreground">Reset Password</h1>
              <p className="text-sm text-muted-foreground">Enter your work email to receive password reset instructions</p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSubmitted(true);
              }}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Work Email</label>
                <Input
                  type="email"
                  icon={<Mail className="w-4 h-4" />}
                  placeholder="alex@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" variant="primary" className="w-full">
                Send Reset Link
              </Button>
            </form>
          </>
        ) : (
          <div className="text-center space-y-4 py-4">
            <div className="p-3 rounded-full bg-emerald-500/10 text-emerald-400 w-12 h-12 mx-auto flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold text-foreground">Check your email</h2>
            <p className="text-sm text-muted-foreground">We sent a password reset link to {email || "your email"}</p>
          </div>
        )}

        <div className="text-center pt-2">
          <Link href="/login" className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
}
