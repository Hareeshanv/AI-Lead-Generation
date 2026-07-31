"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Sparkles, Mail, Lock, User, Building, ArrowRight } from "lucide-react";
import { useAuthStore } from "@/stores/useAuthStore";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { login } = useAuthStore();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      login(email || "new.user@enterprise.io");
      router.push("/dashboard");
    }, 800);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      <div className="w-full max-w-md glass-panel p-8 rounded-2xl border border-white/10 shadow-2xl space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex p-3 rounded-2xl bg-gradient-to-tr from-primary to-indigo-500 text-white shadow-lg mb-2">
            <Sparkles className="w-6 h-6 animate-pulse" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Create AI LeadGen Account</h1>
          <p className="text-sm text-muted-foreground">Start discovering & converting leads on autopilot</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">Full Name</label>
            <Input
              type="text"
              icon={<User className="w-4 h-4" />}
              placeholder="Alex Sterling"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

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

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">Company Name</label>
            <Input
              type="text"
              icon={<Building className="w-4 h-4" />}
              placeholder="Nexus Corp"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">Password</label>
            <Input
              type="password"
              icon={<Lock className="w-4 h-4" />}
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <Button type="submit" variant="primary" className="w-full" isLoading={loading}>
            Create Workspace <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-primary font-semibold hover:underline">
            Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}
