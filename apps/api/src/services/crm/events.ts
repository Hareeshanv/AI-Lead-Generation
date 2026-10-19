import type { EventBase } from "../../events";

declare module "../../events" {
  interface DomainEventMap {
    /** A timeline entry was logged by a user (note, call, email, WhatsApp, meeting). */
    "activity.created": EventBase & {
      activityId: string;
      type: string;
      leadId?: string | null;
      dealId?: string | null;
    };
  }
}
