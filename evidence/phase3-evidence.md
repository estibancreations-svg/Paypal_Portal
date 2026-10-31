# Phase 3 Evidence — Agent Wallets
Date: Fri Oct 30, 2026 · Repo: https://github.com/estibancreations-svg/Paypal_Portal

## Built
- `src/wallets.js` — the WalletEngine. A wallet is a sub-ledger of the **owner's** account, operated by one agent under one signed mandate (the engine refuses a mandate issued to a different agent). Enforced rules:
  - **Gate first:** every spend runs the Phase 2 mandate authorization (signature, revocation, expiry, caps, allowlist, daily spend tracked from the ledger). A blocked decision never debits.
  - **Stops at zero:** a spend larger than the wallet balance blocks with the reason written out — the agent can never reach the owner's other money.
  - **Held jobs:** job payments sit in `HELD` and do not count as earnings until `verifyDelivery` releases them; double verification is refused.
  - **Live-mode sweep:** on release, earnings refill the wallet to its operating cap; the excess sweeps to the owner and is recorded as a `SWEEP` ledger entry + owner sweep record.
  - **P&L:** earned / operating spend / swept to owner / net / balance / points earned for owner (points hook wired for Phase 6).
  - Every wallet action appends to the hash-chained audit log.
- Server wiring (`src/server.js`): `POST /api/wallets`, `GET /api/wallets/:agentId` (wallet + P&L), `POST /api/wallets/:agentId/spend`, `POST /api/jobs`, `POST /api/jobs/:id/verify-delivery`.

## Verified
- Full test suite: **21 passed, 0 failed** (6 Phase 1 + 7 Phase 2 + 8 Phase 3): in-mandate spend debits · blocked spend never debits · stop-at-zero · revoked mandate blocks spend · job held until verified · Live sweep math (earn 1200 onto 1500 with cap 2000 → sweep 700, balance 2000) · Live-off keeps earnings · P&L totals · double-verify refused · audit chain intact.
- Live server smoke (Oct 30): wallet created (balance 1500, cap 2000, Live on) → spend $10.00 at Harbor Tours **pass** (balance 500) → spend $1.00 at Casino **block** ("not on the mandate allowlist") → job $12.00 verified → RELEASED, balance 1700 (under cap, correctly no sweep) → P&L reads earned 1200 / spend 1000 / net 200 → audit verify **ok, 8 entries**.

## Buildout exit check (Phase 3) — MET
"An agent books inside its mandate and the capture is recorded; an agent that tries over its limit is blocked; a completed job's earnings land, refill the wallet to its cap, and the excess shows as swept to the owner." — proven in tests and over the live API. (The PayPal-side capture for a wallet spend fires through the Phase 1 Orders client when the server runs with Sandbox credentials — the live credential proof remains the one open Phase 1 item, waiting on Steve's Client ID + Secret; it blocks nothing in the engine.)

## Next
Phase 4 — risk service + Guidelines Generator (Nov 3–5 window with Phases 5–6, full steam per Steve Oct 30).
