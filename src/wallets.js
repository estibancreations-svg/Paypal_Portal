// PayPortal — agent wallets (Phase 3, Level 2).
// A wallet is a sub-ledger of the OWNER's account, operated by one agent
// under one signed mandate. The agent is software: it never owns funds.
// Rules enforced here, in code:
//  - Every spend passes the Phase 2 mandate gate first (signature, status,
//    expiry, caps, allowlist). A blocked mandate decision never debits.
//  - A wallet can only spend what it holds. At zero it stops — it can never
//    reach into the owner's other money.
//  - Job payments are HELD until delivery is verified. Only then do they
//    become earnings.
//  - Live mode: earnings refill the operating wallet up to its cap; every
//    cent above the cap sweeps to the owner automatically.
import { randomUUID } from 'node:crypto';

export class WalletEngine {
  constructor({ mandates, audit = null }) {
    if (!mandates) throw new Error('WalletEngine requires the mandate registry');
    this.mandates = mandates;
    this.audit = audit;
    this.wallets = new Map(); // agentId -> wallet
    this.jobs = new Map();    // jobId -> job
    this.ledger = [];         // { id, agentId, type: EARN|SPEND|SWEEP, amountCents, at, ref }
    this.ownerSweeps = [];    // { ownerId, agentId, amountCents, at }
    this.pointsByAgent = new Map(); // agentId -> points earned for the owner (Phase 6 hook)
  }

  log(type, entry) {
    if (this.audit) this.audit.append({ type, ...entry });
  }

  addLedger(agentId, type, amountCents, ref = '') {
    const entry = { id: randomUUID(), agentId, type, amountCents, at: new Date().toISOString(), ref };
    this.ledger.push(entry);
    return entry;
  }

  createWallet({ agentId, mandateId, operatingCapCents, liveMode = true, openingBalanceCents = 0 }) {
    const record = this.mandates.get(mandateId);
    if (!record) throw new Error('mandate not found');
    if (record.payload.agentId !== agentId) throw new Error('mandate is not issued to this agent');
    if (!Number.isInteger(operatingCapCents) || operatingCapCents < 0) throw new Error('operatingCapCents must be a non-negative integer (cents)');
    if (this.wallets.has(agentId)) throw new Error('wallet already exists for this agent');
    const wallet = {
      id: randomUUID(), agentId, ownerId: record.payload.ownerId, mandateId,
      operatingCapCents, liveMode, balanceCents: openingBalanceCents,
      createdAt: new Date().toISOString(),
    };
    this.wallets.set(agentId, wallet);
    this.log('wallet.created', { agentId, ownerId: wallet.ownerId, mandateId });
    return wallet;
  }

  getWallet(agentId) {
    return this.wallets.get(agentId) || null;
  }

  spentTodayCents(mandateId, day = new Date().toISOString().slice(0, 10)) {
    return this.ledger
      .filter((e) => e.type === 'SPEND' && e.at.startsWith(day))
      .filter((e) => this.wallets.get(e.agentId)?.mandateId === mandateId)
      .reduce((sum, e) => sum + e.amountCents, 0);
  }

  // The spend path. Gate first, balance second, debit last.
  spend(agentId, proposal) {
    const wallet = this.wallets.get(agentId);
    if (!wallet) return { decision: 'block', reasons: ['wallet not found'] };
    const gate = this.mandates.authorize(wallet.mandateId, proposal, { spentTodayCents: this.spentTodayCents(wallet.mandateId) });
    if (gate.decision !== 'pass') {
      this.log('payment.blocked', { agentId, amountCents: proposal?.amountCents, reasons: gate.reasons });
      return gate;
    }
    if (proposal.amountCents > wallet.balanceCents) {
      const reasons = [`insufficient operating funds: wallet holds ${wallet.balanceCents}, needs ${proposal.amountCents} — the agent stops at zero`];
      this.log('payment.blocked', { agentId, amountCents: proposal.amountCents, reasons });
      return { decision: 'block', reasons };
    }
    wallet.balanceCents -= proposal.amountCents;
    this.addLedger(agentId, 'SPEND', proposal.amountCents, proposal.merchant || proposal.category || '');
    this.log('agent.spent', { agentId, amountCents: proposal.amountCents, balanceCents: wallet.balanceCents });
    return { decision: 'pass', reasons: [], balanceCents: wallet.balanceCents };
  }

  // ---- Earning: jobs are held until delivery is verified ----
  createJob({ agentId, title, amountCents }) {
    if (!this.wallets.has(agentId)) throw new Error('wallet not found for agent');
    if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('job amountCents must be a positive integer (cents)');
    const job = { id: randomUUID(), agentId, title: title || '', amountCents, status: 'HELD', createdAt: new Date().toISOString(), releasedAt: null };
    this.jobs.set(job.id, job);
    this.log('job.held', { agentId, jobId: job.id, amountCents });
    return job;
  }

  verifyDelivery(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error('job not found');
    if (job.status !== 'HELD') throw new Error(`job is ${job.status}, not HELD`);
    const wallet = this.wallets.get(job.agentId);
    job.status = 'RELEASED';
    job.releasedAt = new Date().toISOString();
    wallet.balanceCents += job.amountCents;
    this.addLedger(job.agentId, 'EARN', job.amountCents, job.title);
    this.log('job.released', { agentId: job.agentId, jobId: job.id, amountCents: job.amountCents });
    const sweep = this.sweepIfLive(wallet);
    return { job, balanceCents: wallet.balanceCents, sweep };
  }

  // Live mode: refill to the operating cap; the excess belongs to the owner.
  sweepIfLive(wallet) {
    if (!wallet.liveMode) return null;
    if (wallet.balanceCents <= wallet.operatingCapCents) return null;
    const amountCents = wallet.balanceCents - wallet.operatingCapCents;
    wallet.balanceCents = wallet.operatingCapCents;
    this.addLedger(wallet.agentId, 'SWEEP', amountCents, 'owner');
    const sweep = { ownerId: wallet.ownerId, agentId: wallet.agentId, amountCents, at: new Date().toISOString() };
    this.ownerSweeps.push(sweep);
    this.log('earnings.swept', sweep);
    return sweep;
  }

  // Phase 6 (Points) records what an agent's captures earned for its owner.
  recordPoints(agentId, points) {
    this.pointsByAgent.set(agentId, (this.pointsByAgent.get(agentId) || 0) + points);
  }

  pnl(agentId) {
    const wallet = this.wallets.get(agentId);
    if (!wallet) return null;
    const sum = (type) => this.ledger.filter((e) => e.agentId === agentId && e.type === type).reduce((s, e) => s + e.amountCents, 0);
    const earnedCents = sum('EARN');
    const operatingSpendCents = sum('SPEND');
    const sweptToOwnerCents = sum('SWEEP');
    return {
      agentId, ownerId: wallet.ownerId,
      earnedCents, operatingSpendCents, sweptToOwnerCents,
      netCents: earnedCents - operatingSpendCents,
      balanceCents: wallet.balanceCents,
      operatingCapCents: wallet.operatingCapCents,
      liveMode: wallet.liveMode,
      pointsEarnedForOwner: this.pointsByAgent.get(agentId) || 0,
    };
  }
}
