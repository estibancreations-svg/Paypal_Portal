# Phase 4 Evidence — Risk Service + Guidelines Generator
Date: Sat Oct 31, 2026 (Day 1 of the 4-day sprint) · Repo: https://github.com/estibancreations-svg/Paypal_Portal

## Built
- `src/risk.js` — the RiskService. It sees only proposals the signed mandate already allows, and its single power is to **hold** a borderline proposal for the owner, with the reason in plain English: above the mandate's everyday threshold (owner-set, or 75% of the per-purchase cap by default), first payment to a merchant under this mandate, or unusual frequency. It cannot approve, raise a cap, or widen an allowlist — blocked proposals never reach it.
- Wallet integration (`src/wallets.js`): the spend path is now **gate → risk → balance → debit**. A hold creates a PENDING record and does **not** debit. `approveHold` re-runs the full mandate gate at execution time (a mandate revoked while the owner was deciding still blocks), then debits. `denyHold` is final — a denied hold can never be approved. Every step is audit-chained (`payment.held`, `payment.approved`, `payment.denied`).
- `src/guidelines.js` — the Guidelines Generator. `parseGuideline` reads the owner's plain English into a structured draft (per-purchase cap, daily cap, everyday threshold, allowlist, expiry — "until New Year", "for N days", or an ISO date — tier, purpose). **A field the words do not state is reported missing, never invented**; `draftToMandateFields` refuses to build a mandate from an incomplete draft. `renderGuideline` reads a signed mandate back in plain English.
- Mandates gained an optional `everydayThresholdCents` field (`src/mandates.js`, covered by the signature like every other field).
- Server wiring: `POST /api/guidelines/draft`, `POST /api/guidelines/sign` (returns the mandate + its plain-English read-back), `GET /api/holds`, `POST /api/holds/:id/approve`, `POST /api/holds/:id/deny`. The server's wallet engine now runs with the risk service attached.

## Verified
- Full test suite: **30 passed, 0 failed** (6 + 7 + 8 + 9 new Phase 4): exact-number parsing · missing fields flagged, invention refused · first-look hold then pass · borderline hold with reason, no debit · approve executes · denial final · **risk can never rescue a mandate block** · **revoked-while-waiting still blocks** · plain-English read-back.
- Live server smoke (Oct 31): the storyboard guideline ("…at most $50 at a time and $150 a day, only at Harbor Tours and Port Cafe, until New Year. Anything above $30 without asking…") drafted with **nothing missing**, signed, and read back verbatim-correct → $25 first spend **HELD** ("first payment to Harbor Tours") → approved → balance 17500 → $40 spend **HELD** ("above the everyday threshold of 3000 cents") → denied → queue empty → audit verify **ok, 9 entries**.

## Buildout exit check (Phase 4) — MET · Day 1 gate — PASSED
"A guideline the owner writes becomes a signed mandate that enforces itself; a borderline proposal is held with a written reason and moves only on the owner's decision." Proven in tests and over the live API. Console core pages (Dashboard / Queue / Wallets / Mandates) are designed in `docs/storyboard-devices.html` + `docs/storyboard-board.html` and bind to these endpoints; their rendered UI build continues in the sprint's console work (Day 2 completion) against this now-live API.

## Next
Day 2 (Sun Nov 1): console completion + Phase 6 points engine. Day 3: world + tenants. Day 4 (Tue Nov 3): Judge Mode + evidence + launch to test.
