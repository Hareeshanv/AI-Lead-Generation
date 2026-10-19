import React from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 py-12">
      <Link href="/login" className="mb-6 flex items-center gap-2.5">
        <div className="p-2 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
          <Sparkles className="w-4 h-4" />
        </div>
        <span className="font-semibold text-base tracking-tight text-foreground">AI LeadGen</span>
      </Link>
      <div className="w-full max-w-sm rounded-xl border border-border bg-card text-card-foreground p-8 shadow-sm space-y-6">
        {children}
      </div>
    </div>
  );
}
