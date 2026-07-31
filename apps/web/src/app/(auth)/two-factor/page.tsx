"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ShieldCheck, Lock } from "lucide-react";

export default function TwoFactorPage() {
  const [code, setCode] = useState("");
  const router = useRouter();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md glass-panel p-8 rounded-2xl border border-white/10 shadow-2xl space-y-6">
        <div className="text-center space-y-2">
          <div className="p-3 rounded-2xl bg-indigo-500/10 text-indigo-400 w-12 h-12 mx-auto flex items-center justify-center mb-2">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Two-Factor Verification</h1>
          <p className="text-sm text-muted-foreground">Enter the 6-digit verification code from your authenticator app</p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            router.push("/dashboard");
          }}
          className="space-y-4"
        >
          <Input
            type="text"
            placeholder="123456"
            className="text-center text-lg tracking-widest font-mono"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
          <Button type="submit" variant="primary" className="w-full">
            Verify & Continue
          </Button>
        </form>
      </div>
    </div>
  );
}
