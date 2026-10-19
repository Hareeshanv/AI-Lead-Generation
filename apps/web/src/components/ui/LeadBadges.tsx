import React from "react";
import { Mail, PhoneCall, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { IntentSignal, Lead, LeadSourcePlatform } from "@/types";

export const SourcePlatformBadge: React.FC<{ platform?: LeadSourcePlatform | null }> = ({ platform }) => {
  if (platform === "meta") {
    return <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-[10px]">Meta (IG/FB)</Badge>;
  }
  if (platform === "google") {
    return <Badge variant="warning" className="text-[10px]">Google Ads</Badge>;
  }
  return null;
};

export const AudienceBadge: React.FC<{ isGuardian?: boolean | null }> = ({ isGuardian }) => {
  if (isGuardian === true) return <Badge variant="indigo" className="text-[10px]">Guardian</Badge>;
  if (isGuardian === false) return <Badge variant="secondary" className="text-[10px]">Student</Badge>;
  return null;
};

export const GuardianConsentBadge: React.FC<{ lead: Pick<Lead, "needsGuardianConsent"> }> = ({ lead }) => {
  if (!lead.needsGuardianConsent) return null;
  return (
    <Badge variant="danger" className="text-[10px] gap-1" title="Student under 18 without guardian confirmation — excluded from automated outreach">
      <ShieldAlert className="w-3 h-3" /> Needs guardian consent
    </Badge>
  );
};

export const RequestedContactBadge: React.FC<{ signal: Pick<IntentSignal, "contactRequested"> }> = ({ signal }) => {
  if (!signal.contactRequested) return null;
  return (
    <Badge variant="success" className="text-[10px] gap-1" title="The author asked to be contacted and published this contact in the post">
      <PhoneCall className="w-3 h-3" /> Requested contact
    </Badge>
  );
};

export const SignalGuardianBadge: React.FC<{ signal: Pick<IntentSignal, "leadRoutingCategory"> }> = ({ signal }) => {
  if (signal.leadRoutingCategory !== "guardian_consent_needed") return null;
  return (
    <Badge variant="danger" className="text-[10px] gap-1" title="The post suggests a minor — involve a parent or guardian before any outreach">
      <ShieldAlert className="w-3 h-3" /> Guardian consent needed
    </Badge>
  );
};

/** The contact the author published, as a tel:/mailto: link, with the sentence that requested contact. */
export const PublishedContact: React.FC<{
  signal: Pick<IntentSignal, "contactRequested" | "publishedContact" | "contactRequestQuote">;
}> = ({ signal }) => {
  if (!signal.contactRequested || !signal.publishedContact) return null;
  const contact = signal.publishedContact;
  const isEmail = contact.includes("@");
  const href = isEmail ? `mailto:${contact}` : `tel:${contact.replace(/[^\d+]/g, "")}`;
  const Icon = isEmail ? Mail : PhoneCall;
  return (
    <div className="space-y-1 text-xs">
      <a href={href} className="inline-flex items-center gap-1 font-medium text-primary hover:underline break-all">
        <Icon className="w-3.5 h-3.5 shrink-0" /> {contact}
      </a>
      {signal.contactRequestQuote && (
        <p className="text-muted-foreground italic line-clamp-3" title={signal.contactRequestQuote}>
          “{signal.contactRequestQuote}”
        </p>
      )}
    </div>
  );
};
