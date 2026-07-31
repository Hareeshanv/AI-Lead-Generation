"use client";

import React, { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuthStore } from "@/stores/useAuthStore";
import { Settings, Shield, Key, CreditCard, User, Building, Moon, Sun } from "lucide-react";
import { useThemeStore } from "@/stores/useThemeStore";

export default function SettingsPage() {
  const { user } = useAuthStore();
  const { theme, toggleTheme } = useThemeStore();
  const [apiKey, setApiKey] = useState("sk-lead-gen-live-9481a8c903b12ef");

  return (
    <DashboardLayout>
      <div>
        <h1 className="text-2xl font-bold text-foreground">Workspace & API Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage organization profile, team permissions, API keys & billing</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card glass className="space-y-4">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <User className="w-4 h-4 text-primary" /> Profile & Account
          </h2>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Full Name</label>
              <Input defaultValue={user?.name} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Email Address</label>
              <Input defaultValue={user?.email} />
            </div>
            <Button variant="primary" size="sm" className="w-full">
              Save Profile Changes
            </Button>
          </div>
        </Card>

        <Card glass className="space-y-4">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Key className="w-4 h-4 text-indigo-400" /> Developer API Keys
          </h2>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Production API Token</label>
              <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            </div>
            <Button variant="outline" size="sm" className="w-full">
              Regenerate API Key
            </Button>
          </div>
        </Card>

        <Card glass className="space-y-4">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-emerald-400" /> Subscription & Billing
          </h2>
          <div className="p-3 rounded-xl bg-card/60 border border-border">
            <div className="text-xs text-muted-foreground">Current Plan</div>
            <div className="text-base font-bold text-foreground">{user?.plan}</div>
            <div className="text-xs text-emerald-400 mt-1">Unlimited Agent Concurrency</div>
          </div>
          <Button variant="primary" size="sm" className="w-full">
            Manage Subscription
          </Button>
        </Card>
      </div>
    </DashboardLayout>
  );
}
