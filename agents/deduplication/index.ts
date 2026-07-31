export class DeduplicationEngine {
  private knownEmails: Set<string> = new Set();
  private knownDomains: Set<string> = new Set();

  async isDuplicate(email: string, domain: string): Promise<boolean> {
    const cleanEmail = email.toLowerCase().trim();
    if (this.knownEmails.has(cleanEmail)) return true;

    this.knownEmails.add(cleanEmail);
    if (domain) this.knownDomains.add(domain.toLowerCase());

    return false;
  }
}

export const deduplicationEngine = new DeduplicationEngine();
