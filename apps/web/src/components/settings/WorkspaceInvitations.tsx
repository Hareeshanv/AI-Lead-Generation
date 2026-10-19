"use client";

import React from "react";
import { Building2, Mail } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useAcceptPendingInvitation, useDeclinePendingInvitation, usePendingInvitations } from "@/hooks/useSettings";
import { switchWorkspace } from "@/lib/auth";
import type { Me, PendingInvite, Role } from "@/types";
import { SectionTitle } from "./shared";

const ROLE_LABEL: Record<Role, string> = { admin: "Admin", manager: "Manager", member: "Member" };

function PendingInviteList({ invites }: { invites: PendingInvite[] }) {
  const accept = useAcceptPendingInvitation();
  const decline = useDeclinePendingInvitation();
  const busyOrgId = accept.isPending || accept.isSuccess ? accept.variables?.orgId : decline.isPending ? decline.variables?.orgId : null;

  const handleDecline = (invite: PendingInvite) => {
    if (!window.confirm(`Decline the invitation to ${invite.orgName}? An admin will have to invite you again.`)) return;
    decline.mutate(invite);
  };

  return (
    <ul className="divide-y divide-border">
      {invites.map((invite) => (
        <li key={invite.invitationId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{invite.orgName}</div>
            <div className="text-xs text-muted-foreground">
              Join as {ROLE_LABEL[invite.role] ?? invite.role} · expires {new Date(invite.expiresAt).toLocaleDateString()}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="hover:text-destructive"
              onClick={() => handleDecline(invite)}
              disabled={Boolean(busyOrgId)}
              aria-label={`Decline the invitation to ${invite.orgName}`}
            >
              Decline
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => accept.mutate(invite)}
              isLoading={busyOrgId === invite.orgId && accept.isPending}
              disabled={Boolean(busyOrgId)}
              aria-label={`Accept the invitation to ${invite.orgName}`}
            >
              Accept and open
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Shown above every dashboard page while the signed-in user has invitations to answer. */
export function PendingInvitationsBanner() {
  const { data: invites } = usePendingInvitations();
  if (!invites || invites.length === 0) return null;
  return (
    <Card className="space-y-1 border-primary/40 bg-primary/5" role="region" aria-label="Workspace invitations">
      <SectionTitle
        icon={Mail}
        title={invites.length === 1 ? "You've been invited to a workspace" : `You've been invited to ${invites.length} workspaces`}
        description="Accepting adds you to the workspace and opens it. You keep access to your current workspaces."
      />
      <PendingInviteList invites={invites} />
    </Card>
  );
}

/** Switcher for users in more than one workspace; pending invitations are answered in the banner above. */
export function WorkspacesCard({ me }: { me: Me }) {
  if (me.memberships.length < 2) return null;

  return (
    <Card className="max-w-xl space-y-4">
      <SectionTitle icon={Building2} title="Your workspaces" description="Switch between the workspaces you belong to." />
      <ul className="divide-y divide-border">
        {me.memberships.map((m) => {
          const isCurrent = m.orgId === me.organization.id;
          return (
            <li key={m.orgId} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">{m.name}</div>
                <div className="text-xs text-muted-foreground">{ROLE_LABEL[m.role] ?? m.role}</div>
              </div>
              {isCurrent ? (
                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">Current</span>
              ) : (
                <Button variant="outline" size="sm" onClick={() => switchWorkspace(m.orgId)}>
                  Switch
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
