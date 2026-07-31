"use client";

import React from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { useAuthStore } from "@/stores/useAuthStore";
import { User, Mail, Shield, Building } from "lucide-react";

export default function ProfilePage() {
  const { user } = useAuthStore();

  return (
    <DashboardLayout>
      <div className="glass-panel p-6 rounded-2xl border border-white/10 flex items-center gap-5">
        <Avatar src={user?.avatar} name={user?.name || "User"} size="lg" className="w-16 h-16 border-2 border-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">{user?.name}</h1>
          <p className="text-sm text-muted-foreground">{user?.role} • {user?.organization}</p>
        </div>
      </div>
    </DashboardLayout>
  );
}
