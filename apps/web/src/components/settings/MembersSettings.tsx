"use client";

import React, { useState } from "react";
import { Mail, UserPlus, Users, X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { QueryState } from "@/components/ui/QueryState";
import { useHasRole } from "@/hooks/useMe";
import {
  useChangeMemberRole,
  useInvitations,
  useInviteMember,
  useMembers,
  useRemoveMember,
  useResendInvite,
  useRevokeInvitation,
  useRevokePendingMember,
} from "@/hooks/useSettings";
import { signOut } from "@/lib/auth";
import type { Me, Role } from "@/types";
import { SectionTitle, fieldError, selectClassName } from "./shared";

const ROLES: { value: Role; label: string; description: string }[] = [
  { value: "admin", label: "Admin", description: "Full access, including settings, members and integrations" },
  { value: "manager", label: "Manager", description: "Manage leads, deals, campaigns and workflows" },
  { value: "member", label: "Member", description: "Work on leads and deals" },
];

const roleLabel = (role: Role) => ROLES.find((r) => r.value === role)?.label ?? role;

export function MembersSettings({ me }: { me: Me }) {
  const isAdmin = useHasRole("admin");
  return (
    <div className="space-y-6">
      {isAdmin && <InviteCard />}
      <MembersCard me={me} isAdmin={isAdmin} />
      {isAdmin && <InvitationsCard />}
    </div>
  );
}

function InviteCard() {
  const invite = useInviteMember();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    invite.mutate({ email: email.trim(), role }, { onSuccess: () => setEmail("") });
  };

  return (
    <Card className="max-w-3xl space-y-4">
      <SectionTitle icon={UserPlus} title="Invite a teammate" description="They'll get an email to set a password and join this workspace." />
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex-1 space-y-1">
          <Input
            aria-label="Email address"
            type="email"
            placeholder="teammate@company.com"
            icon={<Mail className="w-4 h-4" />}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {fieldError(invite.error, "email") && <p className="text-[11px] text-destructive">{fieldError(invite.error, "email")}</p>}
        </div>
        <select aria-label="Role" className={`${selectClassName} sm:w-36`} value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r.value} value={r.value} title={r.description}>
              {r.label}
            </option>
          ))}
        </select>
        <Button type="submit" variant="primary" isLoading={invite.isPending} disabled={!email.trim()}>
          Send invite
        </Button>
      </form>
      <p className="text-[11px] text-muted-foreground">{ROLES.find((r) => r.value === role)?.description}.</p>
    </Card>
  );
}

function MembersCard({ me, isAdmin }: { me: Me; isAdmin: boolean }) {
  const query = useMembers();
  const changeRole = useChangeMemberRole();
  const removeMember = useRemoveMember();
  const revokePending = useRevokePendingMember();
  const resendInvite = useResendInvite();

  const handleRevoke = (userId: string, label: string) => {
    if (!window.confirm(`Revoke the invitation for ${label}?`)) return;
    revokePending.mutate(userId);
  };

  const handleRemove = (userId: string, label: string) => {
    const isSelf = userId === me.user.id;
    const message = isSelf
      ? `Leave ${me.organization.name}? You'll lose access to its leads and data.`
      : `Remove ${label} from ${me.organization.name}?`;
    if (!window.confirm(message)) return;
    removeMember.mutate(userId, {
      onSuccess: () => {
        if (isSelf) void signOut();
      },
    });
  };

  return (
    <Card className="max-w-3xl space-y-4">
      <SectionTitle icon={Users} title="Members" description={isAdmin ? undefined : "Only admins can change roles or remove members."} />
      <QueryState query={query} empty={{ title: "No members yet" }}>
        {(members) => (
          <ul className="divide-y divide-border">
            {members.map((m) => {
              const label = m.fullName || m.email || "Unknown user";
              const isSelf = m.userId === me.user.id;
              const isPending = m.status === "pending";
              return (
                <li key={m.userId} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar src={m.avatarUrl || undefined} name={label} size="sm" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">
                        {label} {isSelf && <span className="text-xs font-normal text-muted-foreground">(you)</span>}
                        {isPending && (
                          <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                            Pending
                          </span>
                        )}
                      </div>
                      {m.email && m.fullName && <div className="truncate text-xs text-muted-foreground">{m.email}</div>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isAdmin ? (
                      <select
                        aria-label={`Role for ${label}`}
                        className={`${selectClassName} h-8 w-32 text-xs`}
                        value={m.role}
                        disabled={changeRole.isPending}
                        onChange={(e) => changeRole.mutate({ userId: m.userId, role: e.target.value as Role })}
                      >
                        {ROLES.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{roleLabel(m.role)}</span>
                    )}
                    {isAdmin && isPending && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => resendInvite.mutate(m.userId)}
                          disabled={resendInvite.isPending}
                          aria-label={`Resend invite to ${label}`}
                        >
                          Resend invite
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRevoke(m.userId, label)}
                          disabled={revokePending.isPending}
                          className="hover:text-destructive"
                          aria-label={`Revoke invitation for ${label}`}
                        >
                          Revoke
                        </Button>
                      </>
                    )}
                    {!isPending && (isAdmin || isSelf) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemove(m.userId, label)}
                        disabled={removeMember.isPending}
                        className="hover:text-destructive"
                      >
                        {isSelf ? "Leave" : "Remove"}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
    </Card>
  );
}

function InvitationsCard() {
  const query = useInvitations();
  const revoke = useRevokeInvitation();

  return (
    <Card className="max-w-3xl space-y-4">
      <SectionTitle icon={Mail} title="Pending invitations" />
      <QueryState query={query} empty={{ title: "No pending invitations", icon: Mail }}>
        {(invitations) => (
          <ul className="divide-y divide-border">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{inv.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {roleLabel(inv.role)} · expires {new Date(inv.expiresAt).toLocaleDateString()}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => revoke.mutate(inv.id)}
                  disabled={revoke.isPending}
                  aria-label={`Revoke invitation for ${inv.email}`}
                >
                  <X className="h-3.5 w-3.5" /> Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </Card>
  );
}
