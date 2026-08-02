"use client";

import React, { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { useAuthStore } from "@/stores/useAuthStore";
import { Settings, Shield, Key, CreditCard, User, Building, Moon, Sun, Sparkles, Copy, Check } from "lucide-react";
import { useThemeStore } from "@/stores/useThemeStore";
import { toast } from "sonner";

export default function SettingsPage() {
  const { user } = useAuthStore();
  const { theme, toggleTheme } = useThemeStore();
  const [apiKey, setApiKey] = useState("sk-lead-gen-live-9481a8c903b12ef");
  const [copied, setCopied] = useState(false);

  const handleCopyKey = () => {
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    toast.success("API key copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    toast.success("Workspace profile changes saved successfully!");
  };

  const handleRegenerateKey = () => {
    const newKey = `sk-lead-gen-live-${Math.random().toString(36).substring(2, 15)}`;
    setApiKey(newKey);
    toast.success("New production API key generated!");
  };

  return (
    <DashboardLayout>
      {/* Top Banner Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass-panel p-6 rounded-2xl border border-white/10">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            Workspace & API Settings <Sparkles className="w-5 h-5 text-indigo-400 animate-pulse" />
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage organization profile, team permissions, API keys, and subscription tier
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="indigo" className="px-3 py-1 bg-indigo-500/10 text-indigo-300 border-indigo-500/30">
            {user?.plan || "Enterprise Autonomous Plan"}
          </Badge>
        </div>
      </div>

      {/* Grid Settings Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Card */}
        <Card glass className="glass-panel-hover space-y-4 p-5">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <User className="w-4 h-4 text-primary" /> Profile & Account
          </h2>
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Full Name</label>
              <Input defaultValue={user?.name || "Alex Sterling"} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Email Address</label>
              <Input defaultValue={user?.email || "alex.sterling@enterprise-ai.io"} className="mt-1" />
            </div>
            <Button variant="primary" size="sm" type="submit" className="w-full">
              Save Profile Changes
            </Button>
          </form>
        </Card>

        {/* API Key Card */}
        <Card glass className="glass-panel-hover space-y-4 p-5">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Key className="w-4 h-4 text-indigo-400" /> Developer API Keys
          </h2>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Production API Token</label>
              <div className="relative mt-1">
                <Input type="password" value={apiKey} readOnly className="pr-10 font-mono text-xs" />
                <button
                  type="button"
                  onClick={handleCopyKey}
                  className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={handleRegenerateKey} className="w-full">
              Regenerate API Key
            </Button>
          </div>
        </Card>

        {/* Billing Card */}
        <Card glass className="glass-panel-hover space-y-4 p-5">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-emerald-400" /> Subscription & Billing
          </h2>
          <div className="p-4 rounded-xl bg-card/60 border border-white/10 space-y-1">
            <div className="text-xs text-muted-foreground">Current Active Plan</div>
            <div className="text-base font-bold text-foreground">{user?.plan || "Enterprise Autonomous"}</div>
            <div className="text-xs text-emerald-400 font-medium">Unlimited Agent Concurrency</div>
          </div>
          <Button
            variant="primary"
            size="sm"
            className="w-full"
            onClick={() => toast.info("Redirecting to billing management portal...")}
          >
            Manage Subscription
          </Button>
        </Card>
      </div>
    </DashboardLayout>
  );
}

