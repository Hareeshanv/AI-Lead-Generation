import { agentGateway } from "../../services/sarvam/agentGateway";

export interface ScoringInput {
  companySize: string;
  annualRevenue: string;
  industry: string;
  hasVerifiedEmail: boolean;
}

export class ScoringAgent {
  async calculateICPScoreAsync(input: ScoringInput): Promise<number> {
    // Prefer Sarvam AI agent if configured
    if (agentGateway.isConfigured("agt-scoring")) {
      const response = await agentGateway.runAgent("agt-scoring", {
        company_size: input.companySize,
        annual_revenue: input.annualRevenue,
        industry: input.industry,
        has_verified_email: input.hasVerifiedEmail,
      });
      if (response && response.success && response.output) {
        const score = response.output.total_score || response.output.scored_lead?.total_score;
        if (typeof score === "number") return Math.min(100, Math.max(0, score));
      }
    }

    // Fallback: Local calculation
    return this.calculateICPScore(input);
  }

  calculateICPScore(input: ScoringInput): number {
    let score = 50;

    if (input.hasVerifiedEmail) score += 20;
    if (input.industry.toLowerCase().includes("saas") || input.industry.toLowerCase().includes("tech") || input.industry.toLowerCase().includes("fintech")) {
      score += 15;
    }
    if (input.annualRevenue.includes("M") || input.annualRevenue.includes("B")) score += 10;
    if (input.companySize.includes("100") || input.companySize.includes("250") || input.companySize.includes("1,000")) score += 5;

    return Math.min(100, Math.max(0, score));
  }
}

export const scoringAgent = new ScoringAgent();
