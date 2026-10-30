# Phase 2 Evidence — Trust Foundation
Date: Fri Oct 30, 2026 · Repo: https://github.com/estibancreations-svg/Paypal_Portal

## Built
- `src/canonical.js` — canonical JSON + SHA-256 / HMAC-SHA256 signing helpers (same payload → same signature, any machine).
- `src/mandates.js` — the mandate engine: mandate creation with locked field rules (owner + agent + passport binding, caps in cents, tier, expiry, allowlist, sweep threshold); signature verification; expiry; deterministic scope evaluation (per-purchase cap, daily cap, currency, allowlist — each block carries its reason); `MandateRegistry` with issue / validate / **revoke (kill switch)** / authorize (validate + scope in one capture gate). There is deliberately **no transfer/reassignment function**.
- `src/audit.js` — append-only hash-chained audit ledger; `verify()` recomputes the chain and reports the exact sequence number where history was altered.
- `src/identity.js` — agent registration bound to one owner; passport issuance by tier; passports are non-transferable by design (the only path is revoke + re-issue).
- Server wiring (`src/server.js`): `POST /api/agents`, `POST /api/passports`, `POST /api/mandates`, `GET /api/mandates/:id`, `POST /api/mandates/:id/revoke`, `POST /api/mandates/:id/authorize`, `GET /api/audit` — every action appends to the audit chain. Signing secret comes from `MANDATE_SIGNING_SECRET` in the server `.env` (never committed).

## Verified
- Full test suite: **13 passed, 0 failed** (6 Phase 1 + 7 Phase 2):
  tampered mandate (amount and allowlist) fails signature · wrong secret fails · issued mandate validates · **revoked mandate fails** · expired mandate fails · in-scope proposal passes · over-cap / over-daily / off-allowlist block with reasons · revoked mandate blocks even an in-scope proposal · audit chain verifies · **altered history detected at the altered entry** · agent ownership binding · passport transfer refused.
- Live server smoke (Oct 30): agent + passport + mandate created over the API → in-scope authorize **pass** → over-cap authorize **block** ("amount 9000 exceeds per-purchase cap 5000") → revoke → authorize **block** ("mandate status is REVOKED") → audit verify **ok, 7 entries**.

## Buildout exit check (Phase 2) — MET
"A payment proposal with a tampered mandate fails validation; a revoked mandate fails validation; chain verification passes on the test log." — all three proven above, in tests and over the live API.

## Still open (unchanged)
Phase 1's live PayPal proof (real sandbox capture + payout IDs) still waits on Steve's Sandbox Client ID + Secret. Phase 2 does not depend on it. Next: Phase 3 — agent wallets (spend / earn / held jobs / Live-mode sweep / P&L).
