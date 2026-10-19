import { HttpError } from "../http/errors";
import { getProviderCredentials } from "./credentials";
import { postOutboundWebhook, postSlackMessage } from "./providers";

/** Posts to the workspace's Slack channel (workflow "send Slack" action). Throws NOT_CONFIGURED when Slack is not set up. */
export async function sendSlackNotification(orgId: string, text: string, blocks?: unknown[]): Promise<void> {
  const creds = await getProviderCredentials(orgId, "slack");
  if (!creds) throw HttpError.notConfigured("Slack is not connected. Add an incoming webhook on the Integrations page.");
  await postSlackMessage(creds.webhookUrl, { text, ...(blocks ? { blocks } : {}) });
}

/** POSTs { event, sentAt, orgId, data } to the workspace's outbound webhook (workflow "send webhook" action). */
export async function sendWebhookEvent(orgId: string, event: string, data: Record<string, unknown>): Promise<{ status: number }> {
  const creds = await getProviderCredentials(orgId, "webhook");
  if (!creds) throw HttpError.notConfigured("No outbound webhook is configured. Add one on the Integrations page.");
  return postOutboundWebhook(creds.url, creds.signingSecret, { event, sentAt: new Date().toISOString(), orgId, data });
}
