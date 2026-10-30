// PayPortal — tamper-evident audit ledger (Phase 2, Trust Foundation).
// Append-only, hash-chained: every entry carries the hash of the previous
// entry, so editing, deleting, or reordering history breaks the chain and
// verify() says exactly where. Only hashes would ever be anchored publicly —
// entry contents (names, amounts) never leave the system.
import { canonical, sha256 } from './canonical.js';

export const GENESIS_HASH = 'GENESIS';

export class AuditChain {
  constructor() {
    this.entries = [];
  }

  append(event) {
    const prevHash = this.entries.length ? this.entries[this.entries.length - 1].hash : GENESIS_HASH;
    const entry = {
      seq: this.entries.length,
      at: new Date().toISOString(),
      event,
      prevHash,
    };
    entry.hash = sha256(prevHash + canonical({ seq: entry.seq, at: entry.at, event: entry.event }));
    this.entries.push(entry);
    return entry;
  }

  headHash() {
    return this.entries.length ? this.entries[this.entries.length - 1].hash : GENESIS_HASH;
  }

  // Recompute the whole chain. Returns { ok: true } or { ok: false, atSeq }.
  verify() {
    let prevHash = GENESIS_HASH;
    for (const entry of this.entries) {
      if (entry.prevHash !== prevHash) return { ok: false, atSeq: entry.seq, problem: 'prevHash mismatch' };
      const expected = sha256(prevHash + canonical({ seq: entry.seq, at: entry.at, event: entry.event }));
      if (entry.hash !== expected) return { ok: false, atSeq: entry.seq, problem: 'hash mismatch (entry altered)' };
      prevHash = entry.hash;
    }
    return { ok: true, entries: this.entries.length, headHash: this.headHash() };
  }

  toJSON() {
    return this.entries;
  }

  static fromJSON(entries) {
    const chain = new AuditChain();
    chain.entries = entries;
    return chain;
  }
}
