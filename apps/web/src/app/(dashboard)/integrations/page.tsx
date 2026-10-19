"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Globe,
  Mail,
  Megaphone,
  MessageCircle,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Slack,
  Trash2,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ErrorState, LoadingState } from "@/components/ui/QueryState";
import { PageHeader } from "@/components/layout/PageHeader";
import { API_BASE_URL, ApiError, integrationApi } from "@/services/api";
import {
  useCreateGoogleSource,
  useDisconnectIntegration,
  useIntegrations,
  useRemoveLeadSource,
  useSaveIntegration,
  useTestIntegration,
} from "@/hooks/useIntegrations";
import { useHasRole } from "@/hooks/useMe";
import { cn } from "@/lib/utils";
import type { IntegrationProvider, LeadSourceIntegration, ProviderIntegration } from "@/types";

const META_TEST_TOOL_URL = "https://developers.facebook.com/tools/lead-ads-testing";

const PROVIDER_ICONS: Record<IntegrationProvider, LucideIcon> = {
  resend: Mail,
  whatsapp: MessageCircle,
  serper: Globe,
  sarvam: Bot,
  slack: Slack,
  webhook: Webhook,
  meta: Megaphone,
};

/** Endpoints the provider must call back; shown in the configure dialog. */
const PROVIDER_CALLBACKS: Partial<Record<IntegrationProvider, { label: string; path: string }[]>> = {
  resend: [{ label: "Resend webhook URL", path: "/webhooks/resend" }],
  whatsapp: [{ label: "WhatsApp webhook callback URL", path: "/webhooks/whatsapp" }],
  meta: [{ label: "OAuth redirect URI", path: "/integrations/meta/callback" }],
};

const formatTime = (iso: string | null, empty = "Never"): string => {
  if (!iso) return empty;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

const copyToClipboard = async (value: string, label: string) => {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied to clipboard.`);
  } catch {
    toast.error(`Could not copy ${label.toLowerCase()}. Select and copy it manually.`);
  }
};

const CopyField: React.FC<{ label: string; value: string; secret?: boolean }> = ({ label, value, secret }) => (
  <div className="space-y-1">
    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
    <div className="flex items-center gap-2">
      <code
        className={cn(
          "flex-1 min-w-0 truncate px-2.5 py-1.5 rounded-lg bg-card/60 border border-border text-xs font-mono",
          secret ? "text-amber-400" : "text-indigo-400"
        )}
        title={value}
      >
        {value}
      </code>
      <Button variant="outline" size="sm" onClick={() => copyToClipboard(value, label)} aria-label={`Copy ${label}`}>
        <Copy className="w-3.5 h-3.5" />
      </Button>
    </div>
  </div>
);

const StatusBadge: React.FC<{ integration: ProviderIntegration }> = ({ integration }) => {
  if (integration.status === "connected") return <Badge variant="success">Connected</Badge>;
  if (integration.status === "error") return <Badge variant="danger">Error</Badge>;
  return <Badge variant="secondary">Not configured</Badge>;
};

// ---------------------------------------------------------------------------------------------
// Provider credentials
// ---------------------------------------------------------------------------------------------

const ConfigureDialog: React.FC<{ integration: ProviderIntegration; metaWebhookUrl: string | null; onClose: () => void }> = ({
  integration,
  metaWebhookUrl,
  onClose,
}) => {
  const save = useSaveIntegration();
  const savedInVault = integration.source === "vault";
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      integration.fields.map((f) => [f.key, !f.secret && savedInVault ? f.value ?? "" : ""])
    )
  );
  const fieldErrors = save.error instanceof ApiError ? save.error.fields ?? {} : {};

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate(
      { provider: integration.provider, credentials: values },
      { onSuccess: (result) => result.check.ok && onClose() }
    );
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Configure ${integration.name}`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit" form="integration-form" isLoading={save.isPending}>
            Save & test
          </Button>
        </>
      }
    >
      <form id="integration-form" onSubmit={submit} className="space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          {integration.description} Secrets are stored encrypted in Supabase Vault and are never shown again.
          {integration.source === "env" && " The server environment currently provides these credentials; saving here overrides them for this workspace."}
        </p>

        {integration.fields.map((field) => {
          const errors = fieldErrors[`credentials.${field.key}`];
          const keepHint = field.secret && savedInVault && field.value ? `Saved (${field.value}). Leave blank to keep.` : null;
          return (
            <label key={field.key} className="block space-y-1">
              <span className="text-xs font-medium text-foreground">
                {field.label}
                {field.required && <span className="text-rose-400"> *</span>}
              </span>
              <Input
                type={field.secret ? "password" : "text"}
                autoComplete="off"
                placeholder={keepHint ? "••••••••" : field.placeholder ?? ""}
                value={values[field.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                aria-invalid={!!errors}
                className={errors ? "border-rose-500/60" : undefined}
              />
              {errors ? (
                <span className="block text-[11px] text-rose-400">{errors.join(" ")}</span>
              ) : (
                (keepHint || field.help) && (
                  <span className="block text-[11px] text-muted-foreground">{keepHint ?? field.help}</span>
                )
              )}
            </label>
          );
        })}

        {(PROVIDER_CALLBACKS[integration.provider] ?? []).map((cb) => (
          <CopyField key={cb.path} label={cb.label} value={`${API_BASE_URL.replace(/\/+$/, "")}${cb.path}`} />
        ))}

        {integration.provider === "meta" && metaWebhookUrl && (
          <div className="space-y-1">
            <CopyField label="Leadgen webhook callback URL" value={metaWebhookUrl} />
            <p className="text-[11px] text-muted-foreground">
              In your Meta app, subscribe the Page &quot;leadgen&quot; webhook to this URL and use the verify token above. It only accepts
              requests signed with this workspace&apos;s app secret.
            </p>
          </div>
        )}

        {save.data && !save.data.check.ok && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Saved, but the live check failed: {save.data.check.message}
            </span>
          </div>
        )}
      </form>
    </Modal>
  );
};

const ProviderCard: React.FC<{
  integration: ProviderIntegration;
  isAdmin: boolean;
  canTest: boolean;
  onConfigure: () => void;
}> = ({ integration, isAdmin, canTest, onConfigure }) => {
  const test = useTestIntegration();
  const disconnect = useDisconnectIntegration();
  const Icon = PROVIDER_ICONS[integration.provider] ?? Puzzle;
  const configured = integration.status !== "not_configured";
  const shown = integration.fields.filter((f) => f.value);

  const handleDisconnect = () => {
    const fallback = "If the server environment also has credentials for it, those will be used instead.";
    if (!window.confirm(`Remove the saved ${integration.name} credentials for this workspace? ${fallback}`)) return;
    disconnect.mutate(integration.provider);
  };

  return (
    <Card glass className={cn("p-5 flex flex-col gap-4", integration.status === "error" && "border-rose-500/40")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
            <Icon className="w-[18px] h-[18px]" />
          </span>
          <div className="min-w-0">
            <h3 className="font-semibold text-foreground text-base tracking-tight truncate">{integration.name}</h3>
            <span className="text-[10px] text-muted-foreground font-mono uppercase">
              {integration.source === "vault" ? "Saved for this workspace" : integration.source === "env" ? "From server environment" : integration.category.replace("_", " ")}
            </span>
          </div>
        </div>
        <StatusBadge integration={integration} />
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{integration.description}</p>

      {shown.length > 0 && (
        <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
          {shown.map((f) => (
            <React.Fragment key={f.key}>
              <dt className="text-muted-foreground">{f.label}</dt>
              <dd className="font-mono text-foreground truncate" title={f.secret ? undefined : f.value ?? undefined}>
                {f.value}
              </dd>
            </React.Fragment>
          ))}
        </dl>
      )}

      {integration.lastError && (
        <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="break-words">{integration.lastError}</span>
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          {configured ? `Last checked: ${formatTime(integration.lastCheckedAt, "not yet")}` : "Not set up"}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {isAdmin && (
            <Button variant={configured ? "outline" : "primary"} size="sm" onClick={onConfigure}>
              <Settings2 className="w-3.5 h-3.5" /> {configured ? "Edit" : "Configure"}
            </Button>
          )}
          {configured && canTest && (
            <Button variant="outline" size="sm" onClick={() => test.mutate(integration.provider)} isLoading={test.isPending}>
              {!test.isPending && <RefreshCw className="w-3.5 h-3.5" />} Test
            </Button>
          )}
          {isAdmin && integration.source === "vault" && (
            <Button variant="ghost" size="sm" onClick={handleDisconnect} isLoading={disconnect.isPending} aria-label={`Disconnect ${integration.name}`}>
              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
};

const ProvidersSection: React.FC<{ providers: ProviderIntegration[]; metaWebhookUrl: string | null }> = ({ providers, metaWebhookUrl }) => {
  const isAdmin = useHasRole("admin");
  const canTest = useHasRole("manager");
  const [editing, setEditing] = useState<IntegrationProvider | null>(null);
  const editingIntegration = providers.find((p) => p.provider === editing) ?? null;
  const problems = providers.filter((p) => p.status === "error").length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Providers</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Messaging, search and AI services used by campaigns, the discovery agent and workflows. Credentials are checked live when
          saved and re-checked every hour.
          {problems > 0 && <span className="text-rose-400"> {problems} need{problems === 1 ? "s" : ""} attention.</span>}
          {!isAdmin && " Only workspace admins can change credentials."}
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {providers.map((p) => (
          <ProviderCard
            key={p.provider}
            integration={p}
            isAdmin={isAdmin}
            canTest={canTest}
            onConfigure={() => setEditing(p.provider)}
          />
        ))}
      </div>
      {editingIntegration && (
        <ConfigureDialog integration={editingIntegration} metaWebhookUrl={metaWebhookUrl} onClose={() => setEditing(null)} />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------------------------
// Ad lead sources (Meta pages via OAuth, Google Ads webhooks)
// ---------------------------------------------------------------------------------------------

const SourceRow: React.FC<{ source: LeadSourceIntegration; onRemove?: (s: LeadSourceIntegration) => void; removing: boolean }> = ({
  source,
  onRemove,
  removing,
}) => (
  <div className="p-3 rounded-lg bg-card/40 border border-border space-y-2">
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground truncate">
          {source.pageName || source.externalPageId || (source.platform === "google" ? "Google Ads lead form" : "Facebook Page")}
        </div>
        <div className="text-[10px] text-muted-foreground">
          Last lead: {formatTime(source.lastLeadAt, "No leads yet")}
          {source.formIds.length > 0 && ` · ${source.formIds.length} form${source.formIds.length === 1 ? "" : "s"}`}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Badge variant={source.status === "active" ? "success" : source.status === "error" ? "danger" : "secondary"} className="text-[10px] capitalize">
          {source.status}
        </Badge>
        {onRemove && (
          <Button variant="ghost" size="sm" disabled={removing} onClick={() => onRemove(source)} aria-label="Disconnect source">
            <Trash2 className="w-3.5 h-3.5 text-rose-400" />
          </Button>
        )}
      </div>
    </div>
    {source.webhookUrl && <CopyField label="Webhook URL" value={source.webhookUrl} />}
  </div>
);

const RECOMMENDED_QUESTIONS: { question: string; type: string; answers?: string; why: string }[] = [
  {
    question: "I am a:",
    type: "Multiple choice",
    answers: "Parent/Guardian | Student 18+ | Student under 18",
    why: "Leads from students under 18 with no guardian are flagged “Needs guardian consent” and kept out of automated outreach.",
  },
  {
    question: "Course interested in",
    type: "Multiple choice or short answer",
    answers: "e.g. NEET | JEE | Foundation (Class 8–10)",
    why: "Fills the Course interest filter and helps the scoring agent judge intent.",
  },
  {
    question: "Exam year",
    type: "Multiple choice",
    answers: "e.g. 2026 | 2027 | 2028",
    why: "Fills the Exam year filter; nearer exam years usually mean more urgent intent.",
  },
  {
    question: "I agree to be contacted by call and WhatsApp about this course",
    type: "Consent checkbox (required)",
    why: "Records explicit consent under the DPDP Act 2023. The consent time is shown on every lead.",
  },
];

const AdLeadSourcesSection: React.FC<{ sources: LeadSourceIntegration[]; metaConfigured: boolean }> = ({ sources, metaConfigured }) => {
  const isAdmin = useHasRole("admin");
  const removeSource = useRemoveLeadSource();
  const createGoogle = useCreateGoogleSource();
  const [googleName, setGoogleName] = useState("");
  const [newGoogleWebhook, setNewGoogleWebhook] = useState<{ webhookUrl: string; webhookKey: string } | null>(null);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [connectingMeta, setConnectingMeta] = useState(false);

  const handleRemove = (source: LeadSourceIntegration) => {
    const label = source.pageName || (source.platform === "meta" ? "this Meta page" : "this Google Ads webhook");
    if (!window.confirm(`Disconnect ${label}? New leads from it will stop arriving.`)) return;
    removeSource.mutate(source.id);
  };

  const handleCreateGoogle = () =>
    createGoogle.mutate(googleName.trim() || undefined, {
      onSuccess: (result) => {
        setNewGoogleWebhook({ webhookUrl: result.webhookUrl, webhookKey: result.webhookKey });
        setGoogleName("");
      },
    });

  const handleConnectMeta = async () => {
    setConnectingMeta(true);
    try {
      window.location.href = await integrationApi.getMetaConnectUrl();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start the Meta connection.");
      setConnectingMeta(false);
    }
  };

  const metaSources = sources.filter((s) => s.platform === "meta");
  const googleSources = sources.filter((s) => s.platform === "google");

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Ad lead forms</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Consented leads from Instagram/Facebook and Google lead-form ads arrive on the Leads page in real time.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card glass className="space-y-4 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
                <Megaphone className="w-[18px] h-[18px]" />
              </span>
              <div>
                <h3 className="font-semibold text-foreground text-base tracking-tight">Meta Lead Ads pages</h3>
                <span className="text-[10px] text-muted-foreground font-mono uppercase">Instagram & Facebook</span>
              </div>
            </div>
            {metaSources.length > 0 ? (
              <Badge variant="success">{metaSources.length} page{metaSources.length === 1 ? "" : "s"} connected</Badge>
            ) : (
              <Badge variant="secondary">Not connected</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Log in with Facebook, pick your Pages, and every lead-form submission is fetched and saved automatically.
          </p>

          {!metaConfigured && (
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Configure the Meta Lead Ads app (App ID and secret) in Providers above before connecting pages.</span>
            </div>
          )}

          {metaSources.length > 0 && (
            <div className="space-y-2">
              {metaSources.map((s) => (
                <SourceRow
                  key={s.id}
                  source={s}
                  onRemove={isAdmin ? handleRemove : undefined}
                  removing={removeSource.isPending && removeSource.variables === s.id}
                />
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {isAdmin && (
              <Button variant="primary" size="sm" disabled={!metaConfigured} isLoading={connectingMeta} onClick={handleConnectMeta}>
                {metaSources.length > 0 ? "Connect another Page" : "Connect Meta Lead Ads"}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => window.open(META_TEST_TOOL_URL, "_blank", "noopener,noreferrer")}>
              <ExternalLink className="w-3.5 h-3.5" /> Send test lead
            </Button>
          </div>
        </Card>

        <Card glass className="space-y-4 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
                <Search className="w-[18px] h-[18px]" />
              </span>
              <div>
                <h3 className="font-semibold text-foreground text-base tracking-tight">Google Ads Lead Forms</h3>
                <span className="text-[10px] text-muted-foreground font-mono uppercase">Search, YouTube & Discovery</span>
              </div>
            </div>
            {googleSources.length > 0 ? (
              <Badge variant="success">{googleSources.length} webhook{googleSources.length === 1 ? "" : "s"}</Badge>
            ) : (
              <Badge variant="secondary">Not connected</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Create a webhook, then paste its URL and key into each lead form in Google Ads. No app review is needed.
          </p>

          {newGoogleWebhook && (
            <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                <CheckCircle2 className="w-4 h-4" /> Webhook created — copy the key now, it will not be shown again
              </div>
              <CopyField label="Webhook URL" value={newGoogleWebhook.webhookUrl} />
              <CopyField label="Key" value={newGoogleWebhook.webhookKey} secret />
              <ol className="list-decimal list-inside text-xs text-muted-foreground space-y-1 leading-relaxed">
                <li>In Google Ads, open your campaign&apos;s <strong className="text-foreground">lead form asset</strong>.</li>
                <li>Go to <strong className="text-foreground">Lead delivery</strong> &gt; <strong className="text-foreground">Webhook integration</strong>.</li>
                <li>Paste the webhook URL and key above.</li>
                <li>Click <strong className="text-foreground">Send test data</strong> — a lead tagged &quot;test&quot; should appear on the Leads page.</li>
              </ol>
              <Button variant="ghost" size="sm" onClick={() => setNewGoogleWebhook(null)}>
                I&apos;ve saved the key
              </Button>
            </div>
          )}

          {googleSources.length > 0 && (
            <div className="space-y-2">
              {googleSources.map((s) => (
                <SourceRow
                  key={s.id}
                  source={s}
                  onRemove={isAdmin ? handleRemove : undefined}
                  removing={removeSource.isPending && removeSource.variables === s.id}
                />
              ))}
            </div>
          )}

          {isAdmin && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[180px]">
                <Input
                  placeholder="Label (optional), e.g. NEET 2027 Bengaluru"
                  value={googleName}
                  onChange={(e) => setGoogleName(e.target.value)}
                />
              </div>
              <Button variant="primary" size="sm" isLoading={createGoogle.isPending} onClick={handleCreateGoogle}>
                <Plus className="w-3.5 h-3.5" /> Create webhook
              </Button>
            </div>
          )}
        </Card>
      </div>

      <Card glass className="p-0 overflow-hidden">
        <button
          type="button"
          onClick={() => setIsGuideOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-2 p-4 text-left hover:bg-card/40 transition-colors"
          aria-expanded={isGuideOpen}
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <BookOpen className="w-4 h-4 text-indigo-400" /> Form setup guide
            <span className="text-[10px] font-normal text-muted-foreground">Recommended custom questions for consent and scoring</span>
          </span>
          {isGuideOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </button>
        {isGuideOpen && (
          <div className="px-4 pb-4 space-y-4 border-t border-border">
            <p className="text-xs text-muted-foreground leading-relaxed pt-4">
              Lead forms already collect name, phone number and email. Add these custom questions to every form (Meta: Instant Form &gt;
              Questions &gt; Custom questions; Google: Lead form asset &gt; Questions) so leads are scored correctly and comply with India&apos;s
              DPDP Act 2023.
            </p>
            <div className="space-y-2">
              {RECOMMENDED_QUESTIONS.map((q, idx) => (
                <div key={q.question} className="p-3 rounded-lg bg-card/40 border border-border">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-semibold text-foreground">
                      {idx + 1}. {q.question}
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0">{q.type}</Badge>
                  </div>
                  {q.answers && <div className="text-xs text-indigo-400 font-mono mt-1">{q.answers}</div>}
                  <div className="text-xs text-muted-foreground mt-1">{q.why}</div>
                </div>
              ))}
            </div>
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Leads where the answer is <strong>Student under 18</strong> are marked <strong>Needs guardian consent</strong> and are excluded
                from automated calls, WhatsApp and email until a parent or guardian confirms. Use the lead&apos;s
                &quot;Erase (data deletion request)&quot; action to honour deletion requests.
              </span>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};

/** Shows the result of the redirect back from Meta OAuth (?meta=connected | ?meta=error&message=...). */
function useMetaRedirectToast() {
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const params = new URLSearchParams(window.location.search);
    const metaResult = params.get("meta");
    if (!metaResult) return;
    if (metaResult === "connected") {
      toast.success("Meta Lead Ads connected. New Instagram/Facebook leads will appear automatically.");
    } else if (metaResult === "error") {
      toast.error(`Meta connection failed: ${params.get("message") || "Unknown error"}`);
    }
    params.delete("meta");
    params.delete("message");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, []);
}

export default function IntegrationsPage() {
  const query = useIntegrations();
  useMetaRedirectToast();

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Connect messaging, search and AI providers, alerts, and ad lead forms."
        icon={Puzzle}
        actions={
          <Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
            <RefreshCw className={cn("w-4 h-4", query.isFetching && "animate-spin")} /> Refresh
          </Button>
        }
      />

      {query.isLoading ? (
        <LoadingState rows={4} />
      ) : query.isError || !query.data ? (
        <ErrorState title="Couldn't load integrations" error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <ProvidersSection providers={query.data.providers} metaWebhookUrl={query.data.metaWebhookUrl} />
          <AdLeadSourcesSection sources={query.data.sources} metaConfigured={query.data.metaConfigured} />
        </>
      )}
    </>
  );
}
