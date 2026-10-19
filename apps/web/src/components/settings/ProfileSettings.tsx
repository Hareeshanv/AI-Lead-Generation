"use client";

import React, { useEffect, useState } from "react";
import { KeyRound, User } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { useUpdateProfile } from "@/hooks/useMe";
import { getSupabase } from "@/lib/supabase/client";
import { authErrorMessage } from "@/lib/auth";
import { notifyError, notifySuccess } from "@/lib/toast";
import type { Me } from "@/types";
import { Field, SectionTitle, fieldError } from "./shared";

export function ProfileSettings({ me }: { me: Me }) {
  const updateProfile = useUpdateProfile();
  const [fullName, setFullName] = useState(me.user.fullName ?? "");
  const [avatarUrl, setAvatarUrl] = useState(me.user.avatarUrl ?? "");

  useEffect(() => {
    setFullName(me.user.fullName ?? "");
    setAvatarUrl(me.user.avatarUrl ?? "");
  }, [me.user.fullName, me.user.avatarUrl]);

  const isDirty = fullName.trim() !== (me.user.fullName ?? "") || avatarUrl.trim() !== (me.user.avatarUrl ?? "");

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfile.mutate({ fullName: fullName.trim(), avatarUrl: avatarUrl.trim() || null });
  };

  return (
    <div className="space-y-6">
      <Card className="max-w-xl space-y-4">
        <SectionTitle icon={User} title="Profile" description="How you appear to your teammates." />
        <form onSubmit={handleSave} className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar src={avatarUrl.trim() || undefined} name={fullName || me.user.email || "User"} size="lg" />
            <div className="text-sm">
              <div className="font-medium text-foreground">{fullName || "Your name"}</div>
              <div className="text-muted-foreground">{me.user.email}</div>
            </div>
          </div>
          <Field id="profile-name" label="Full name" error={fieldError(updateProfile.error, "fullName")}>
            <Input id="profile-name" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} required />
          </Field>
          <Field
            id="profile-avatar"
            label="Avatar URL"
            hint="Link to a square image (optional)."
            error={fieldError(updateProfile.error, "avatarUrl")}
          >
            <Input
              id="profile-avatar"
              type="url"
              placeholder="https://…"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
            />
          </Field>
          <Field id="profile-email" label="Email" hint="Your sign-in email can't be changed here.">
            <Input id="profile-email" value={me.user.email ?? ""} disabled readOnly />
          </Field>
          <div className="flex justify-end">
            <Button variant="primary" size="sm" type="submit" disabled={!isDirty || !fullName.trim()} isLoading={updateProfile.isPending}>
              Save changes
            </Button>
          </div>
        </form>
      </Card>

      <ChangePasswordCard />
    </div>
  );
}

function ChangePasswordCard() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const mismatch = confirm.length > 0 && password !== confirm;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return;
    setIsSaving(true);
    const { error } = await getSupabase().auth.updateUser({ password });
    setIsSaving(false);
    if (error) {
      notifyError(authErrorMessage(error, "Could not change your password."));
      return;
    }
    setPassword("");
    setConfirm("");
    notifySuccess("Password changed");
  };

  return (
    <Card className="max-w-xl space-y-4">
      <SectionTitle icon={KeyRound} title="Change password" />
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field id="password-new" label="New password" hint="At least 8 characters.">
          <Input
            id="password-new"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <Field id="password-confirm" label="Confirm new password" error={mismatch ? "Passwords don't match." : undefined}>
          <Input
            id="password-confirm"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </Field>
        <div className="flex justify-end">
          <Button variant="primary" size="sm" type="submit" disabled={password.length < 8 || password !== confirm} isLoading={isSaving}>
            Change password
          </Button>
        </div>
      </form>
    </Card>
  );
}
