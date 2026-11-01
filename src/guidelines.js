// PayPortal — the Guidelines Generator (Phase 4, Level 3).
// The owner writes the rules in plain English. This generator turns the
// words into a structured mandate draft — and, after signing, turns a
// signed mandate back into plain English so the owner can read exactly
// what is being enforced. Extraction is deterministic: a field the words
// do not state is reported as MISSING, never invented. The owner reviews
// and edits the draft; signing is a separate, deliberate step that hands
// the draft to the mandate engine.
import { TIERS } from './mandates.js';

const dollarsToCents = (s) => Math.round(Number(s) * 100);

export function parseGuideline(text, now = new Date()) {
  const draft = { purpose: '', perPurchaseCapCents: null, dailyCapCents: null, allowlist: [], expiresAt: null, tier: 'MEMBER', everydayThresholdCents: null };
  const t = ` ${text} `;

  const perPurchase = t.match(/\$(\d+(?:\.\d{1,2})?)\s*(?:at a time|per purchase|each time|per booking|a booking)/i);
  if (perPurchase) draft.perPurchaseCapCents = dollarsToCents(perPurchase[1]);
  const daily = t.match(/\$(\d+(?:\.\d{1,2})?)\s*(?:a day|per day|daily|each day)/i);
  if (daily) draft.dailyCapCents = dollarsToCents(daily[1]);
  const everyday = t.match(/\$(\d+(?:\.\d{1,2})?)\s*(?:without asking|before asking|no approval)/i);
  if (everyday) draft.everydayThresholdCents = dollarsToCents(everyday[1]);

  const allow = t.match(/only (?:at|from|with) ([^.,]+)/i);
  if (allow) {
    draft.allowlist = allow[1]
      .split(/,| and /)
      .map((s) => s.trim().replace(/\.$/, ''))
      .filter(Boolean)
      .map((s) => s.replace(/\b\w/g, (c) => c.toUpperCase()));
  }

  if (/until new year/i.test(t)) {
    const jan1 = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
    draft.expiresAt = jan1.toISOString();
  } else {
    const days = t.match(/for (\d+) days/i);
    if (days) draft.expiresAt = new Date(now.getTime() + Number(days[1]) * 86400000).toISOString();
    const until = t.match(/until (\d{4})-(\d{2})-(\d{2})/);
    if (until) draft.expiresAt = new Date(Date.UTC(+until[1], +until[2] - 1, +until[3])).toISOString();
  }

  for (const tier of TIERS) {
    if (new RegExp(`\\b${tier.toLowerCase()}\\b`, 'i').test(t)) { draft.tier = tier; break; }
  }

  const purpose = t.match(/(?:may|can) ([^,.$]+)/i);
  if (purpose) draft.purpose = purpose[1].trim();

  const missing = [];
  if (draft.perPurchaseCapCents === null) missing.push('perPurchaseCapCents');
  if (draft.dailyCapCents === null) missing.push('dailyCapCents');
  if (!draft.expiresAt) missing.push('expiresAt');
  return { draft, missing };
}

// A draft becomes mandate fields only when nothing required is missing.
export function draftToMandateFields(draft, { ownerId, agentId, passportId }) {
  const missing = [];
  if (draft.perPurchaseCapCents === null) missing.push('perPurchaseCapCents');
  if (draft.dailyCapCents === null) missing.push('dailyCapCents');
  if (!draft.expiresAt) missing.push('expiresAt');
  if (missing.length) throw new Error(`guideline draft is missing: ${missing.join(', ')} — the generator never invents a limit`);
  return {
    ownerId, agentId, passportId,
    purpose: draft.purpose || '',
    perPurchaseCapCents: draft.perPurchaseCapCents,
    dailyCapCents: draft.dailyCapCents,
    currency: 'USD',
    allowlist: draft.allowlist || [],
    expiresAt: draft.expiresAt,
    tier: draft.tier || 'MEMBER',
    everydayThresholdCents: draft.everydayThresholdCents ?? null,
  };
}

const money = (cents) => `$${(cents / 100).toFixed(2)}`;

// The signed mandate, read back in the owner's own terms.
export function renderGuideline(payload) {
  const parts = [
    `This agent may ${payload.purpose || 'spend'} under a signed ${payload.tier} mandate.`,
    `At most ${money(payload.perPurchaseCapCents)} at a time and ${money(payload.dailyCapCents)} a day.`,
  ];
  if (payload.everydayThresholdCents !== null && payload.everydayThresholdCents !== undefined) {
    parts.push(`Anything above ${money(payload.everydayThresholdCents)} waits for the owner's approval.`);
  }
  if (payload.allowlist?.length) parts.push(`Only at: ${payload.allowlist.join(', ')}.`);
  parts.push(`Expires ${payload.expiresAt.slice(0, 10)}. Revoking this mandate stops the agent instantly.`);
  return parts.join(' ');
}
