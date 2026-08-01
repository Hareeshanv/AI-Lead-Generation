import { agentGateway } from "../../services/sarvam/agentGateway";

export class DeduplicationEngine {
  private knownEmails: Set<string> = new Set();
  private knownDomains: Set<string> = new Set();

  async isDuplicate(email: string, domain: string): Promise<boolean> {
    // Prefer Sarvam AI agent if configured
    if (agentGateway.isConfigured("agt-deduplication")) {
      const response = await agentGateway.runAgent("agt-deduplication", { email, domain });
      if (response && response.success && response.output) {
        return response.output.is_duplicate === true;
      }
    }

    // Fallback: Local in-memory deduplication
    const cleanEmail = email.toLowerCase().trim();
    if (this.knownEmails.has(cleanEmail)) return true;

    this.knownEmails.add(cleanEmail);
    if (domain) this.knownDomains.add(domain.toLowerCase());

    return false;
  }
}

export const deduplicationEngine = new DeduplicationEngine();
