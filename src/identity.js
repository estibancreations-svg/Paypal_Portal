// PayPortal — identity: agents and passports (Phase 2, Trust Foundation).
// An agent is software registered to exactly one owner. A passport is issued
// to exactly one owner at one tier and is NON-TRANSFERABLE by design: this
// module deliberately exposes no reassignment path — the only way to move a
// passport's authority is for the owner to revoke it and issue a new one.
import { randomUUID } from 'node:crypto';
import { TIERS } from './mandates.js';

export class IdentityRegistry {
  constructor() {
    this.agents = new Map();    // agentId -> { id, ownerId, name, createdAt }
    this.passports = new Map(); // passportId -> { id, ownerId, tier, createdAt, status }
  }

  registerAgent({ ownerId, name }) {
    if (!ownerId || !name) throw new Error('registerAgent requires ownerId and name');
    const agent = { id: randomUUID(), ownerId, name, createdAt: new Date().toISOString() };
    this.agents.set(agent.id, agent);
    return agent;
  }

  issuePassport({ ownerId, tier = 'MEMBER' }) {
    if (!ownerId) throw new Error('issuePassport requires ownerId');
    if (!TIERS.includes(tier)) throw new Error(`tier must be one of ${TIERS.join(', ')}`);
    const passport = { id: randomUUID(), ownerId, tier, status: 'ACTIVE', createdAt: new Date().toISOString() };
    this.passports.set(passport.id, passport);
    return passport;
  }

  revokePassport(id) {
    const passport = this.passports.get(id);
    if (!passport) return false;
    passport.status = 'REVOKED';
    return true;
  }

  // The non-transferable rule, made explicit so callers and tests can see it:
  // authority changes hands only by revoke + re-issue under the new owner.
  transferPassport() {
    return { ok: false, reason: 'Passports are non-transferable. Revoke this passport and issue a new one to the new owner.' };
  }

  ownsAgent(ownerId, agentId) {
    const agent = this.agents.get(agentId);
    return Boolean(agent && agent.ownerId === ownerId);
  }
}
