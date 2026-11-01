// PayPortal — the risk service (Phase 4, Level 3).
// The risk service sits BETWEEN a passed mandate gate and the capture. It
// sees only proposals the signed mandate already allows. Its one power is
// to HOLD a borderline proposal for the owner's decision, with the reason
// written in plain English. It cannot approve, cannot raise a cap, cannot
// widen an allowlist — hard limits live in the mandate engine, and blocked
// proposals never reach this service at all.
export class RiskService {
  constructor({ maxProposalsPerHour = 5 } = {}) {
    this.maxProposalsPerHour = maxProposalsPerHour;
  }

  // Returns { decision: 'pass' | 'hold', reasons: string[] }.
  // context: { knownMerchants: string[], proposalsLastHour: number }
  evaluate(mandatePayload, proposal, context = {}) {
    const reasons = [];
    const threshold = mandatePayload.everydayThresholdCents
      ?? Math.floor(mandatePayload.perPurchaseCapCents * 0.75);
    if (proposal.amountCents > threshold) {
      reasons.push(`above the everyday threshold of ${threshold} cents (mandate cap is ${mandatePayload.perPurchaseCapCents})`);
    }
    const merchant = (proposal.merchant || '').toLowerCase();
    if (merchant && Array.isArray(context.knownMerchants)
      && !context.knownMerchants.some((m) => m.toLowerCase() === merchant)) {
      reasons.push(`first payment to "${proposal.merchant}" under this mandate`);
    }
    if ((context.proposalsLastHour || 0) >= this.maxProposalsPerHour) {
      reasons.push(`unusual frequency: ${context.proposalsLastHour} proposals in the last hour`);
    }
    return { decision: reasons.length ? 'hold' : 'pass', reasons };
  }
}
