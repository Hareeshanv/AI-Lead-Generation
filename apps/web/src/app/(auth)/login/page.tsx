"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Sparkles, Mail, Lock, ArrowRight, Github } from "lucide-react";
import { useAuthStore } from "@/stores/useAuthStore";

export default function LoginPage() {
  const [email, setEmail] = useState("alex.sterling@enterprise-ai.io");
  const [password, setPassword] = useState("••••••••••••");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { login } = useAuthStore();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      login(email);
      router.push("/dashboard");
    }, 800);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Glow Effects */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-3xl -z-10 pointer-events-none animate-pulse-slow" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl -z-10 pointer-events-none" />

      <div className="w-full max-w-md glass-panel p-8 rounded-2xl border border-white/10 shadow-2xl space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex p-3 rounded-2xl bg-gradient-to-tr from-primary to-indigo-500 text-white shadow-lg shadow-primary/30 mb-2">
            <Sparkles className="w-6 h-6 animate-pulse" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Welcome to AI LeadGen Pro</h1>
          <p className="text-sm text-muted-foreground">Log in to control your autonomous lead generation agents</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">Work Email</label>
            <Input
              type="email"
              icon={<Mail className="w-4 h-4" />}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-foreground">Password</label>
              <Link href="/forgot-password" className="text-xs text-primary hover:underline font-medium">
                Forgot password?
              </Link>
            </div>
            <Input
              type="password"
              icon={<Lock className="w-4 h-4" />}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <Button type="submit" variant="primary" className="w-full" isLoading={loading}>
            Sign In to Dashboard <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        </form>

        <div className="relative flex items-center justify-center my-4">
          <div className="border-t border-border w-full" />
          <span className="bg-card px-3 text-xs text-muted-foreground absolute uppercase tracking-wider font-medium">
            Or single sign-on
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" className="w-full text-xs">
            <Github className="w-4 h-4 mr-2" /> GitHub
          </Button>
          <Button variant="outline" className="w-full text-xs">
            Google SSO
          </Button>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Don't have an enterprise workspace?{" "}
          <Link href="/register" className="text-primary font-semibold hover:underline">
            Request Access
          </Link>
        </p>
      </div>
    </div>
  );
}
