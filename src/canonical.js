// PayPortal — canonical JSON + signing helpers (zero dependencies).
// Canonicalization: object keys sorted recursively, arrays kept in order,
// no whitespace. The same payload always produces the same string — and
// therefore the same signature and the same audit hash — on any machine.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function sign(payload, secret) {
  return createHmac('sha256', secret).update(canonical(payload)).digest('hex');
}

export function signatureMatches(payload, secret, signature) {
  const expected = sign(payload, secret);
  if (typeof signature !== 'string' || signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
