export interface ScoringInput {
  companySize: string;
  annualRevenue: string;
  industry: string;
  hasVerifiedEmail: boolean;
}

export class ScoringAgent {
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
