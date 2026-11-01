// Phase 4 tests — risk service + Guidelines Generator exit checks:
// a guideline the owner writes becomes a signed mandate that enforces
// itself; a borderline proposal is HELD with a written reason and moves
// only on the owner's decision; the risk service can never override a
// mandate block; a held proposal does not debit until approved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MandateRegistry } from '../src/mandates.js';
import { WalletEngine } from '../src/wallets.js';
import { RiskService } from '../src/risk.js';
import { AuditChain } from '../src/audit.js';
import { parseGuideline, draftToMandateFields, renderGuideline } from '../src/guidelines.js';

const SECRET = 'test-signing-secret';
const FUTURE = '2027-01-01T00:00:00.000Z';
const GUIDELINE = 'My concierge may book port tours and cafes, at most $50 at a time and $150 a day, only at Harbor Tours and Port Cafe, until New Year. Anything above $30 without asking is too much.';
const NOW = new Date('2026-10-31T12:00:00.000Z');

function setupFromGuideline() {
  const mandates = new MandateRegistry(SECRET);
  const audit = new AuditChain();
  const { draft, missing } = parseGuideline(GUIDELINE, NOW);
  const signed = mandates.issue(draftToMandateFields(draft, { ownerId: 'owner-1', agentId: 'agent-1', passportId: 'passport-1' }));
  const engine = new WalletEngine({ mandates, audit, risk: new RiskService() });
  engine.createWallet({ agentId: 'agent-1', mandateId: signed.payload.id, operatingCapCents: 20000, liveMode: true, openingBalanceCents: 20000 });
  return { mandates, audit, engine, signed, draft, missing };
}

test('the generator reads the owner\'s words into exact numbers — and invents nothing', () => {
  const { draft, missing } = parseGuideline(GUIDELINE, NOW);
  assert.deepEqual(missing, []);
  assert.equal(draft.perPurchaseCapCents, 5000);
  assert.equal(draft.dailyCapCents, 15000);
  assert.equal(draft.everydayThresholdCents, 3000);
  assert.deepEqual(draft.allowlist, ['Harbor Tours', 'Port Cafe']);
  assert.equal(draft.expiresAt, '2027-01-01T00:00:00.000Z');
  const vague = parseGuideline('My agent may spend money.', NOW);
  assert.ok(vague.missing.includes('perPurchaseCapCents'));
  assert.throws(() => draftToMandateFields(vague.draft, { ownerId: 'o', agentId: 'a', passportId: 'p' }), /never invents/);
});

test('a signed guideline enforces itself: first look approved once, then ordinary spend passes', () => {
  const { engine } = setupFromGuideline();
  const first = engine.spend('agent-1', { amountCents: 2500, merchant: 'Harbor Tours' });
  assert.equal(first.decision, 'hold'); // first payment to this merchant — one owner look
  assert.match(first.reasons.join(' '), /first payment/);
  engine.approveHold(first.holdId);
  assert.equal(engine.getWallet('agent-1').balanceCents, 17500);
  const second = engine.spend('agent-1', { amountCents: 2500, merchant: 'Harbor Tours' }); // known merchant, under threshold
  assert.equal(second.decision, 'pass');
  assert.equal(engine.getWallet('agent-1').balanceCents, 15000);
});

test('borderline spend is HELD with a written reason and does not debit', () => {
  const { engine } = setupFromGuideline();
  const result = engine.spend('agent-1', { amountCents: 4000, merchant: 'Harbor Tours' }); // inside caps, above $30 threshold
  assert.equal(result.decision, 'hold');
  assert.match(result.reasons.join(' '), /everyday threshold/);
  assert.equal(engine.getWallet('agent-1').balanceCents, 20000); // untouched while held
  assert.equal(engine.pendingHolds().length, 1);
});

test('approval executes the held spend; the audit chain tells the whole story', () => {
  const { engine, audit } = setupFromGuideline();
  const held = engine.spend('agent-1', { amountCents: 4000, merchant: 'Harbor Tours' });
  const approved = engine.approveHold(held.holdId);
  assert.equal(approved.decision, 'pass');
  assert.equal(engine.getWallet('agent-1').balanceCents, 16000);
  const types = audit.entries.map((e) => e.event.type);
  assert.ok(types.includes('payment.held') && types.includes('payment.approved') && types.includes('agent.spent'));
  assert.equal(audit.verify().ok, true);
});

test('denial is final: a denied hold can never be approved afterward', () => {
  const { engine } = setupFromGuideline();
  const held = engine.spend('agent-1', { amountCents: 4000, merchant: 'Harbor Tours' });
  engine.denyHold(held.holdId);
  assert.throws(() => engine.approveHold(held.holdId), /not PENDING/);
  assert.equal(engine.getWallet('agent-1').balanceCents, 20000);
});

test('the risk service can never rescue what the mandate blocks', () => {
  const { engine } = setupFromGuideline();
  const overCap = engine.spend('agent-1', { amountCents: 5001, merchant: 'Harbor Tours' }); // above the $50 hard cap
  assert.equal(overCap.decision, 'block');
  const offList = engine.spend('agent-1', { amountCents: 100, merchant: 'Casino' });
  assert.equal(offList.decision, 'block');
  assert.equal(engine.pendingHolds().length, 0); // blocks never become holds
});

test('a mandate revoked while a proposal waits still blocks it at approval time', () => {
  const { engine, mandates, signed } = setupFromGuideline();
  const held = engine.spend('agent-1', { amountCents: 4000, merchant: 'Harbor Tours' });
  mandates.revoke(signed.payload.id); // kill switch while the owner is deciding
  const result = engine.approveHold(held.holdId);
  assert.equal(result.decision, 'block');
  assert.equal(engine.getWallet('agent-1').balanceCents, 20000);
});

test('first payment to a new (allowed) merchant is held for a first look', () => {
  const { engine } = setupFromGuideline();
  engine.spend('agent-1', { amountCents: 1000, merchant: 'Harbor Tours' }); // first: held (new merchant)
  const first = engine.pendingHolds()[0];
  engine.approveHold(first.id);
  const again = engine.spend('agent-1', { amountCents: 1000, merchant: 'Harbor Tours' }); // now known, under threshold
  assert.equal(again.decision, 'pass');
});

test('the signed mandate reads back in plain English', () => {
  const { signed } = setupFromGuideline();
  const words = renderGuideline(signed.payload);
  assert.match(words, /\$50\.00 at a time and \$150\.00 a day/);
  assert.match(words, /Harbor Tours, Port Cafe/);
  assert.match(words, /above \$30\.00 waits for the owner's approval/);
});
