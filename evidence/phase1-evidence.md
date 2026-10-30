# Phase 1 Evidence — Rails Proof
Date: Thu Oct 29, 2026 · Repo: https://github.com/estibancreations-svg/Paypal_Portal (public — created by Steve Oct 29, Muse app access granted Oct 29, Phase 1 snapshot pushed by Jason via the GitHub connector; local git history: commits 66c3d1e, 5dc45cb)

## Built and verified (no credentials needed)
- Repo scaffold: `src/` (config, PayPal client, proof server), `public/` (bare proof page), `scripts/prove-live.js`, `test/`, `evidence/`, MIT LICENSE, README with run instructions, `.env.example` (no secrets anywhere in the repo; `.env` is git-ignored).
- PayPal client (`src/paypal.js`): OAuth client-credentials with token caching; Orders create / capture / authorize / get; capture read-back; Payouts create (idempotency key = sender batch id) / batch + item read-backs; webhook signature verification call.
- Automated tests (stubbed PayPal API, `node --test`): **6 passed, 0 failed** —
  token grant shape · create-order payload (CAPTURE intent, amount, currency) · capture read-back extraction · payout payload + idempotency header · webhook verification payload · API error surfacing (422 with body).
- Server smoke test: boots on Node 24; `GET /api/health` → `{ok:true, configured:false}`; order attempt without credentials returns the exact configuration instruction instead of failing obscurely.

## Live sandbox proof — PENDING (one blocker)
Exit check per the buildout: one sandbox capture and one sandbox payout, both read back as completed, IDs recorded here.
Status: **not yet run.** It requires the PayPal Sandbox app credentials (Client ID + Secret), which live in Steve's PayPal Developer account — a human-only account step (see `../payportal-account-setup-checklist.md`).
When the credentials are in the local `.env`, `npm run prove` executes: payout $1.00 → read back to terminal status; order $10.00 → approval URL printed → buyer approves → `npm run prove -- <ORDER_ID>` captures and reads back. Raw run JSON lands in `evidence/live-run-*.json` and the IDs get copied into this file.

| Proof | ID | Read-back status |
|---|---|---|
| Payout batch | — pending — | — |
| Order | — pending — | — |
| Capture | — pending — | — |
