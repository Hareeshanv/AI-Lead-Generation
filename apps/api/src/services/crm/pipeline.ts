/** Deal pipeline rules. Pure functions only so they can be unit tested. */

export const DEAL_STAGES = ["New", "Qualified", "Proposal", "Negotiation", "Closed Won", "Closed Lost"] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const LEAD_STATUSES = ["New", "Contacted", "Qualified", "Hot", "Warm", "Cold", "Closed"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Default win probability (%) per stage. */
export const STAGE_PROBABILITY: Record<DealStage, number> = {
  New: 10,
  Qualified: 25,
  Proposal: 50,
  Negotiation: 75,
  "Closed Won": 100,
  "Closed Lost": 0,
};

export const isClosedStage = (stage: string): boolean => stage === "Closed Won" || stage === "Closed Lost";

/**
 * Lead status implied by moving one of its deals into `stage`; null means leave the lead alone
 * (a deal back in "New" says nothing new about the lead).
 */
export function leadStatusForDealStage(stage: string): LeadStatus | null {
  switch (stage) {
    case "Qualified":
    case "Proposal":
    case "Negotiation":
      return "Qualified";
    case "Closed Won":
      return "Closed";
    case "Closed Lost":
      return "Cold";
    default:
      return null;
  }
}

/**
 * Probability after a stage change: follows the stage default unless the user had customised it
 * (it no longer matched the previous stage's default). Closed stages always force 100 / 0.
 */
export function probabilityAfterStageChange(from: string | null, to: string, current: number | null | undefined): number {
  const target = STAGE_PROBABILITY[to as DealStage];
  if (target === undefined) return current ?? 0;
  if (isClosedStage(to)) return target;
  const previousDefault = from ? STAGE_PROBABILITY[from as DealStage] : undefined;
  if (current == null || isClosedStage(from ?? "") || current === previousDefault) return target;
  return current;
}

/** Fields written when a deal moves from `from` to `to`. */
export function stageChangePatch(
  deal: { stage: string | null; probability?: number | null },
  to: string,
  options: { lostReason?: string | null; now?: Date } = {}
): Record<string, unknown> {
  const now = options.now ?? new Date();
  const patch: Record<string, unknown> = {
    stage: to,
    probability: probabilityAfterStageChange(deal.stage, to, deal.probability),
  };
  if (isClosedStage(to)) {
    if (!isClosedStage(deal.stage ?? "")) patch.closed_at = now.toISOString();
  } else {
    patch.closed_at = null;
  }
  if (to === "Closed Lost") patch.lost_reason = options.lostReason ?? null;
  else if (deal.stage === "Closed Lost") patch.lost_reason = null;
  return patch;
}

/** Sum of value and probability-weighted value. */
export function pipelineTotals(deals: { value?: number | string | null; probability?: number | null }[]) {
  let total = 0;
  let weighted = 0;
  for (const deal of deals) {
    const value = Number(deal.value) || 0;
    total += value;
    weighted += (value * (Number(deal.probability) || 0)) / 100;
  }
  return { total, weighted: Math.round(weighted * 100) / 100 };
}
