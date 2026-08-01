import { emailVerifier } from "../../services/email";
import { agentGateway } from "../../services/sarvam/agentGateway";

export class VerifierAgent {
  async verify(email: string) {
    // Prefer Sarvam AI agent if configured
    if (agentGateway.isConfigured("agt-verifier")) {
      const response = await agentGateway.runAgent("agt-verifier", { email });
      if (response && response.success && response.output) {
        const ev = response.output.email_verification || response.output;
        return {
          email,
          isValid: ev.is_valid ?? ev.isValid ?? true,
          score: ev.confidence_score ? Math.round(ev.confidence_score * 100) : (ev.score || 98),
          isDisposable: ev.is_disposable ?? ev.checks?.is_disposable ?? false,
          hasMxRecords: ev.checks?.mx_records ?? ev.hasMxRecords ?? true,
          status: (ev.status === "valid" ? "Verified" : ev.status === "risky" ? "Risky" : ev.status === "invalid" ? "Bounced" : ev.status) as "Verified" | "Risky" | "Bounced",
          reason: ev.risk_level ? `Risk level: ${ev.risk_level}` : "Sarvam AI verification completed",
        };
      }
    }

    // Fallback: Local stub
    return await emailVerifier.verifyEmail(email);
  }
}

export const verifierAgent = new VerifierAgent();
