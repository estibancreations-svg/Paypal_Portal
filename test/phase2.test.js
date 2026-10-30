// Phase 2 tests — mandate engine exit checks from the buildout:
// a tampered mandate fails validation, a revoked mandate fails validation,
// the audit chain verifies, and tampering with the chain is detected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMandate, verifyMandateSignature, evaluateProposal, MandateRegistry } from '../src/mandates.js';
import { AuditChain } from '../src/audit.js';
import { IdentityRegistry } from '../src/identity.js';

const SECRET = 'test-signing-secret';
const FUTURE = '2027-01-01T00:00:00.000Z';
const fields = {
  ownerId: 'owner-1', agentId: 'agent-1', passportId: 'passport-1',
  purpose: 'Port services', perPurchaseCapCents: 5000, dailyCapCents: 15000,
  allowlist: ['Harbor Tours', 'Port Cafe'], expiresAt: FUTURE, tier: 'MEMBER',
};

test('a signed mandate verifies; any tampering breaks the signature', () => {
  const signed = createMandate(fields, SECRET);
  assert.equal(verifyMandateSignature(signed, SECRET), true);
  const tamperedAmount = { payload: { ...signed.payload, perPurchaseCapCents: 999999 }, signature: signed.signature };
  assert.equal(verifyMandateSignature(tamperedAmount, SECRET), false);
  const tamperedAllowlist = { payload: { ...signed.payload, allowlist: ['Anywhere'] }, signature: signed.signature };
  assert.equal(verifyMandateSignature(tamperedAllowlist, SECRET), false);
  assert.equal(verifyMandateSignature(signed, 'wrong-secret'), false);
});

test('registry: issued mandate validates; revoked mandate fails (kill switch)', () => {
  const registry = new MandateRegistry(SECRET);
  const signed = registry.issue(fields);
  assert.equal(registry.validate(signed.payload.id).valid, true);
  assert.equal(registry.revoke(signed.payload.id), true);
  const after = registry.validate(signed.payload.id);
  assert.equal(after.valid, false);
  assert.match(after.reasons.join(' '), /REVOKED/);
});

test('registry: expired mandate fails validation', () => {
  const registry = new MandateRegistry(SECRET);
  const signed = registry.issue({ ...fields, expiresAt: '2020-01-01T00:00:00.000Z' });
  const result = registry.validate(signed.payload.id);
  assert.equal(result.valid, false);
  assert.match(result.reasons.join(' '), /expired/);
});

test('scope check: inside passes; over-cap, over-daily, off-allowlist all block with reasons', () => {
  const { payload } = createMandate(fields, SECRET);
  assert.equal(evaluateProposal(payload, { amountCents: 4000, merchant: 'Harbor Tours' }).decision, 'pass');
  const overCap = evaluateProposal(payload, { amountCents: 5001, merchant: 'Harbor Tours' });
  assert.equal(overCap.decision, 'block');
  assert.match(overCap.reasons.join(' '), /per-purchase cap/);
  const overDaily = evaluateProposal(payload, { amountCents: 4000, merchant: 'Harbor Tours' }, { spentTodayCents: 12000 });
  assert.equal(overDaily.decision, 'block');
  assert.match(overDaily.reasons.join(' '), /daily cap/);
  const offList = evaluateProposal(payload, { amountCents: 1000, merchant: 'Casino' });
  assert.equal(offList.decision, 'block');
  assert.match(offList.reasons.join(' '), /allowlist/);
});

test('authorize(): a revoked mandate blocks even an in-scope proposal', () => {
  const registry = new MandateRegistry(SECRET);
  const signed = registry.issue(fields);
  registry.revoke(signed.payload.id);
  const result = registry.authorize(signed.payload.id, { amountCents: 100, merchant: 'Harbor Tours' });
  assert.equal(result.decision, 'block');
});

test('audit chain verifies; altering a past entry is detected at that entry', () => {
  const chain = new AuditChain();
  chain.append({ type: 'mandate.issued', id: 'm1' });
  chain.append({ type: 'payment.proposed', id: 'p1', amountCents: 4000 });
  chain.append({ type: 'payment.blocked', id: 'p2', reason: 'allowlist' });
  assert.deepEqual(chain.verify(), { ok: true, entries: 3, headHash: chain.headHash() });
  chain.entries[1].event.amountCents = 999999; // rewrite history
  const after = chain.verify();
  assert.equal(after.ok, false);
  assert.equal(after.atSeq, 1);
});

test('identity: agent binds to one owner; passports cannot be transferred', () => {
  const identity = new IdentityRegistry();
  const agent = identity.registerAgent({ ownerId: 'owner-1', name: 'Concierge' });
  assert.equal(identity.ownsAgent('owner-1', agent.id), true);
  assert.equal(identity.ownsAgent('owner-2', agent.id), false);
  const passport = identity.issuePassport({ ownerId: 'owner-1', tier: 'PREMIUM' });
  assert.equal(passport.tier, 'PREMIUM');
  const attempt = identity.transferPassport(passport.id, 'owner-2');
  assert.equal(attempt.ok, false);
  assert.match(attempt.reason, /non-transferable/);
});
