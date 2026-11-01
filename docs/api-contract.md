# PayPortal — API Contract

The front-end (`public/`) talks to this API through **one** configurable
base: `API_BASE` at the top of `public/app.js`. Default is `''` — same
origin — because the server serves the pages and the API together. No
other host is named anywhere in the app. All configuration is env-only
(`.env.example`): `MANDATE_SIGNING_SECRET` (required for mandates and
wallets), `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_MODE` (`sandbox`),
`PAYPAL_WEBHOOK_ID`, `PROOF_RECIPIENT_EMAIL`, `PORT`.

Money is always integer cents in the API. Every response is JSON; errors
are `{ "error": "message" }` with an HTTP status.

## System
- `GET /api/health` → `{ ok, configured, baseUrl }` — `configured` = PayPal credentials present.
- `GET /api/overview` → the console feed: `{ configured, agents, passports, mandates (payload, status, validation, guideline read-back), wallets (wallet + pnl), holds (pending), jobs, audit { verify, count, recent } }`.
- `POST /api/demo/seed` → creates a complete demo (agent, passport, signed guideline mandate, funded wallet, held job, one pending hold). Idempotent per server run.
- `GET /api/audit` → `{ verify: { ok, entries, headHash }, entries }`.

## Identity (Phase 2)
- `POST /api/agents` `{ ownerId, name }` → agent. Agents bind to one owner.
- `POST /api/passports` `{ ownerId, tier }` → passport. Non-transferable by design.

## Mandates (Phase 2)
- `POST /api/mandates` — full mandate fields (see `src/mandates.js`); returns `{ payload, signature }`.
- `GET /api/mandates/:id` → record + live validation.
- `POST /api/mandates/:id/revoke` → the kill switch; effective immediately.
- `POST /api/mandates/:id/authorize` `{ proposal, spentTodayCents }` → `{ decision: pass|block, reasons }`.

## Wallets & jobs (Phase 3)
- `POST /api/wallets` `{ agentId, mandateId, operatingCapCents, liveMode, openingBalanceCents }`.
- `GET /api/wallets/:agentId` → `{ wallet, pnl }` (earned / spend / swept / net / balance / points).
- `POST /api/wallets/:agentId/spend` `{ proposal: { amountCents, merchant } }` → `{ decision: pass|hold|block, reasons, balanceCents?, holdId? }`. A `hold` debits nothing.
- `POST /api/jobs` `{ agentId, title, amountCents }` → job in `HELD`.
- `POST /api/jobs/:id/verify-delivery` → releases earnings; in Live mode sweeps the excess over the cap to the owner. Returns `{ job, balanceCents, sweep }`.

## Guidelines & holds (Phase 4)
- `POST /api/guidelines/draft` `{ text }` → `{ draft, missing }`. Missing fields are reported, never invented.
- `POST /api/guidelines/sign` `{ text | draft, ownerId, agentId, passportId }` → signed mandate + `guideline` (plain-English read-back).
- `GET /api/holds` → `{ pending: [...] }`.
- `POST /api/holds/:id/approve` → re-validates the mandate, then executes. Returns the spend result.
- `POST /api/holds/:id/deny` → final.

## PayPal rails (Phase 1)
- `POST /api/proof/order` `{ amount, description }` → `{ orderId, status, approveUrl }` (503 until Sandbox env is set — the error says so).
- `POST /api/proof/order/:id/capture` → capture + read-back.
- `GET /api/proof/order/:id` → read-back.
- `POST /api/proof/payout` `{ email, amount }` → batch + read-back.
- `POST /api/webhooks` → signature-verified when `PAYPAL_WEBHOOK_ID` is set.

## Static
`GET /` the app · `GET /app.js`, `/app.css` · `GET /proof.html` the Phase 1 proof page · `GET /return`, `/cancel` PayPal approval returns.
