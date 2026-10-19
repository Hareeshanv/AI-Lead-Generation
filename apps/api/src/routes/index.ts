import type { Router } from "express";
import { healthRouter } from "./health";
import { meRouter } from "./me";
import { settingsRouter } from "./settings";
import { membersRouter, invitationsRouter } from "./members";
import { leadsRouter } from "./leads";
import { signalsRouter } from "./signals";
import { dealsRouter } from "./deals";
import { tasksRouter, activitiesRouter } from "./tasks";
import { campaignsRouter } from "./campaigns";
import { agentsRouter } from "./agents";
import { discoveryRouter } from "./discovery";
import { workflowsRouter } from "./workflows";
import { analyticsRouter } from "./analytics";
import { integrationsPublicRouter, integrationsRouter } from "./integrations";
import { notificationsRouter } from "./notifications";
import { webhooksRouter } from "./webhooks";
import { devRouter, isDevAutoLoginEnabled } from "./dev";

export interface RouteModule {
  path: string;
  router: Router;
  /**
   * "org" (default): requireAuth() - signed in + org member, req.ctx set.
   * "user": signed in, org optional (onboarding endpoints).
   * "public": no auth (health, provider webhooks, OAuth callbacks); verify signatures yourself.
   */
  auth?: "org" | "user" | "public";
}

/** Mounted in order by app.ts. Public routers sharing a prefix must come before the authenticated one. */
export const routeModules: RouteModule[] = [
  { path: "/api/health", router: healthRouter, auth: "public" },
  { path: "/api/webhooks", router: webhooksRouter, auth: "public" },
  { path: "/api/integrations", router: integrationsPublicRouter, auth: "public" },
  ...(isDevAutoLoginEnabled() ? [{ path: "/api/dev", router: devRouter, auth: "public" as const }] : []),

  { path: "/api/me", router: meRouter, auth: "user" },
  { path: "/api/invitations", router: invitationsRouter },
  { path: "/api/settings", router: settingsRouter },
  { path: "/api/members", router: membersRouter },

  { path: "/api/leads", router: leadsRouter },
  { path: "/api/signals", router: signalsRouter },
  { path: "/api/deals", router: dealsRouter },
  { path: "/api/tasks", router: tasksRouter },
  { path: "/api/activities", router: activitiesRouter },
  { path: "/api/campaigns", router: campaignsRouter },
  { path: "/api/agents", router: agentsRouter },
  { path: "/api/discovery", router: discoveryRouter },
  { path: "/api/workflows", router: workflowsRouter },
  { path: "/api/analytics", router: analyticsRouter },
  { path: "/api/integrations", router: integrationsRouter },
  { path: "/api/notifications", router: notificationsRouter },
];
