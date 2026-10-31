// Phase 3 tests — agent wallet exit checks from the buildout:
// an in-mandate payment captures (ledger-wise), an over-limit or off-mandate
// payment is blocked and never debits, job money stays held until delivery
// is verified, and Live-mode earnings refill to the cap then sweep to the owner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MandateRegistry } from '../src/mandates.js';
import { WalletEngine } from '../src/wallets.js';
import { AuditChain } from '../src/audit.js';

const SECRET = 'test-signing-secret';
const FUTURE = '2027-01-01T00:00:00.000Z';

function setup({ cap = 2000, liveMode = true } = {}) {
  const mandates = new MandateRegistry(SECRET);
  const audit = new AuditChain();
  const signed = mandates.issue({
    ownerId: 'owner-1', agentId: 'agent-1', passportId: 'passport-1',
    purpose: 'Port services', perPurchaseCapCents: 5000, dailyCapCents: 15000,
    allowlist: ['Harbor Tours', 'Port Cafe'], expiresAt: FUTURE, tier: 'MEMBER',
  });
  const engine = new WalletEngine({ mandates, audit });
  const wallet = engine.createWallet({ agentId: 'agent-1', mandateId: signed.payload.id, operatingCapCents: cap, liveMode, openingBalanceCents: 1500 });
  return { mandates, audit, engine, wallet, mandateId: signed.payload.id };
}

test('in-mandate spend passes and debits; blocked spend never debits', () => {
  const { engine } = setup();
  const ok = engine.spend('agent-1', { amountCents: 1000, merchant: 'Harbor Tours' });
  assert.equal(ok.decision, 'pass');
  assert.equal(engine.getWallet('agent-1').balanceCents, 500);
  const blocked = engine.spend('agent-1', { amountCents: 100, merchant: 'Casino' });
  assert.equal(blocked.decision, 'block');
  assert.equal(engine.getWallet('agent-1').balanceCents, 500); // untouched
});

test('an agent stops at zero — it can never spend the owner\'s other money', () => {
  const { engine } = setup();
  const result = engine.spend('agent-1', { amountCents: 3000, merchant: 'Harbor Tours' }); // in-mandate, over balance
  assert.equal(result.decision, 'block');
  assert.match(result.reasons.join(' '), /stops at zero/);
  assert.equal(engine.getWallet('agent-1').balanceCents, 1500);
});

test('a revoked mandate blocks wallet spend immediately', () => {
  const { engine, mandates, mandateId } = setup();
  mandates.revoke(mandateId);
  const result = engine.spend('agent-1', { amountCents: 100, merchant: 'Harbor Tours' });
  assert.equal(result.decision, 'block');
  assert.equal(engine.getWallet('agent-1').balanceCents, 1500);
});

test('job money is HELD until delivery is verified, then released as earnings', () => {
  const { engine } = setup();
  const job = engine.createJob({ agentId: 'agent-1', title: 'Shore-excursion bookings', amountCents: 1200 });
  assert.equal(job.status, 'HELD');
  assert.equal(engine.getWallet('agent-1').balanceCents, 1500); // not yet earned
  const { balanceCents } = engine.verifyDelivery(job.id);
  assert.equal(balanceCents, 2000); // 1500 + 1200 = 2700, capped by sweep below
  assert.equal(engine.jobs.get(job.id).status, 'RELEASED');
});

test('Live mode: earnings refill to the cap, the excess sweeps to the owner', () => {
  const { engine } = setup({ cap: 2000 });
  const job = engine.createJob({ agentId: 'agent-1', title: 'Bookings', amountCents: 1200 });
  const { sweep } = engine.verifyDelivery(job.id);
  assert.equal(sweep.amountCents, 700); // 2700 - 2000 cap
  assert.equal(sweep.ownerId, 'owner-1');
  const pnl = engine.pnl('agent-1');
  assert.equal(pnl.earnedCents, 1200);
  assert.equal(pnl.sweptToOwnerCents, 700);
  assert.equal(pnl.balanceCents, 2000);
});

test('with Live mode off, earnings stay in the wallet above the cap', () => {
  const { engine } = setup({ liveMode: false });
  const job = engine.createJob({ agentId: 'agent-1', title: 'Bookings', amountCents: 1200 });
  const { sweep, balanceCents } = engine.verifyDelivery(job.id);
  assert.equal(sweep, null);
  assert.equal(balanceCents, 2700);
});

test('P&L: earned, operating spend, net, and owner points all read true', () => {
  const { engine } = setup();
  engine.verifyDelivery(engine.createJob({ agentId: 'agent-1', title: 'Bookings', amountCents: 1200 }).id);
  engine.spend('agent-1', { amountCents: 500, merchant: 'Port Cafe' });
  engine.recordPoints('agent-1', 56);
  const pnl = engine.pnl('agent-1');
  assert.equal(pnl.earnedCents, 1200);
  assert.equal(pnl.operatingSpendCents, 500);
  assert.equal(pnl.netCents, 700);
  assert.equal(pnl.sweptToOwnerCents, 700);
  assert.equal(pnl.pointsEarnedForOwner, 56);
});

test('double delivery verification is refused; wallet actions are audit-chained', () => {
  const { engine, audit } = setup();
  const job = engine.createJob({ agentId: 'agent-1', title: 'Bookings', amountCents: 100 });
  engine.verifyDelivery(job.id);
  assert.throws(() => engine.verifyDelivery(job.id), /not HELD/);
  const types = audit.entries.map((e) => e.event.type);
  for (const expected of ['wallet.created', 'job.held', 'job.released']) assert.ok(types.includes(expected), expected);
  assert.equal(audit.verify().ok, true);
});
