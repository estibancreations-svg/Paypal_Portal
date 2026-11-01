// PayPortal — the mandate engine (Phase 2, Trust Foundation).
// A mandate is the owner's signed permission for one passport/agent:
// purpose, per-purchase cap, daily cap, currency, allowlist, expiry, tier,
// and the earnings sweep rule. Rules enforced here, in code:
//  - No valid signature => not a mandate. Any tampering breaks the signature.
//  - A mandate binds exactly one owner and one agent/passport. It cannot be
//    transferred: there is deliberately no reassignment function.
//  - Revocation is immediate: validation consults the registry every time.
//  - Scope checks are deterministic. Nothing in this file asks a model.
import { randomUUID } from 'node:crypto';
import { sign, signatureMatches } from './canonical.js';

export const TIERS = ['OBSERVER', 'MEMBER', 'PREMIUM', 'ENTERPRISE'];

export function createMandate(fields, secret) {
  const {
    ownerId, agentId, passportId, purpose,
    perPurchaseCapCents, dailyCapCents,
    currency = 'USD', allowlist = [], expiresAt, tier = 'MEMBER',
    sweepThresholdCents = null, everydayThresholdCents = null,
  } = fields;
  if (!ownerId || !agentId || !passportId) throw new Error('mandate requires ownerId, agentId, passportId');
  if (!Number.isInteger(perPurchaseCapCents) || perPurchaseCapCents < 0) throw new Error('perPurchaseCapCents must be a non-negative integer (cents)');
  if (!Number.isInteger(dailyCapCents) || dailyCapCents < perPurchaseCapCents) throw new Error('dailyCapCents must be an integer >= perPurchaseCapCents');
  if (!TIERS.includes(tier)) throw new Error(`tier must be one of ${TIERS.join(', ')}`);
  if (!expiresAt || Number.isNaN(Date.parse(expiresAt))) throw new Error('expiresAt must be an ISO date-time');
  const payload = {
    v: 1,
    id: randomUUID(),
    ownerId, agentId, passportId, purpose: purpose || '',
    perPurchaseCapCents, dailyCapCents, currency,
    allowlist: [...allowlist].sort(),
    expiresAt, tier,
    sweepThresholdCents,
    everydayThresholdCents,
    issuedAt: new Date().toISOString(),
  };
  return { payload, signature: sign(payload, secret) };
}

// Static validity: signature integrity + expiry. Registry status (revocation)
// is layered on by MandateRegistry.validate, which is what callers must use.
export function verifyMandateSignature(signed, secret) {
  return signatureMatches(signed.payload, secret, signed.signature);
}

export function isExpired(payload, now = new Date()) {
  return now.getTime() >= Date.parse(payload.expiresAt);
}

// Deterministic scope check for one proposed payment against one mandate.
// Returns { decision: 'pass' | 'block', reasons: string[] }.
export function evaluateProposal(payload, proposal, { spentTodayCents = 0 } = {}) {
  const reasons = [];
  const { amountCents, currency = 'USD', merchant = '', category = '' } = proposal;
  if (!Number.isInteger(amountCents) || amountCents <= 0) reasons.push('amount must be a positive integer (cents)');
  if (currency !== payload.currency) reasons.push(`currency ${currency} does not match mandate currency ${payload.currency}`);
  if (amountCents > payload.perPurchaseCapCents) reasons.push(`amount ${amountCents} exceeds per-purchase cap ${payload.perPurchaseCapCents}`);
  if (spentTodayCents + amountCents > payload.dailyCapCents) reasons.push(`amount would exceed daily cap ${payload.dailyCapCents} (already spent ${spentTodayCents})`);
  if (payload.allowlist.length > 0) {
    const target = (merchant || category || '').toLowerCase();
    const allowed = payload.allowlist.some((entry) => entry.toLowerCase() === target);
    if (!allowed) reasons.push(`"${merchant || category}" is not on the mandate allowlist`);
  }
  return { decision: reasons.length === 0 ? 'pass' : 'block', reasons };
}

export class MandateRegistry {
  constructor(secret) {
    if (!secret) throw new Error('MandateRegistry requires a signing secret');
    this.secret = secret;
    this.mandates = new Map(); // id -> { payload, signature, status }
  }

  issue(fields) {
    const signed = createMandate(fields, this.secret);
    this.mandates.set(signed.payload.id, { ...signed, status: 'ACTIVE' });
    return signed;
  }

  get(id) {
    return this.mandates.get(id) || null;
  }

  // The kill switch. Immediate and total: a revoked mandate never validates again.
  revoke(id) {
    const record = this.mandates.get(id);
    if (!record) return false;
    record.status = 'REVOKED';
    return true;
  }

  // Full validation used before any money movement:
  // exists -> signature intact -> not revoked -> not expired.
  validate(id, now = new Date()) {
    const record = this.mandates.get(id);
    if (!record) return { valid: false, reasons: ['mandate not found'] };
    const reasons = [];
    if (!verifyMandateSignature(record, this.secret)) reasons.push('signature invalid (mandate was altered)');
    if (record.status !== 'ACTIVE') reasons.push(`mandate status is ${record.status}`);
    if (isExpired(record.payload, now)) reasons.push('mandate expired');
    return { valid: reasons.length === 0, reasons, mandate: record };
  }

  // Validate + scope-check a proposal in one call (the capture gate).
  authorize(id, proposal, context = {}) {
    const check = this.validate(id);
    if (!check.valid) return { decision: 'block', reasons: check.reasons };
    return evaluateProposal(check.mandate.payload, proposal, context);
  }
}
