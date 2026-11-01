# PayPortal

The payment passport for virtual worlds and AI agents — pay inside worlds, let
agents pay **and earn** under signed mandates their owner controls, and govern
every cent. All money movement runs on PayPal's APIs in the free Sandbox.

> Status: the full product front-end is built and live against the API
> (all 10 pages), with Phases 1–4 of the engine verified (rails proof ·
> trust foundation · agent wallets · risk service + guidelines generator;
> 30/30 tests). Points minting and the WebXR scene complete the sprint to
> the Nov 3 test launch. Design + storyboards: see `docs/`.

## Run the product

Requirements: Node.js 20+.

```bash
cp .env.example .env   # set MANDATE_SIGNING_SECRET (any long random value);
                       # add the Sandbox app Client ID + Secret for live captures
npm install            # zero dependencies — nothing to install
npm start              # http://localhost:8080
```

Open http://localhost:8080 — the full console. Press **Load demo data** on
the Dashboard to see the system alive instantly (agent, signed mandate,
funded wallet, held job, a proposal waiting in the Approval Queue), or run
**Judge Mode** for the guided 4-step live run. The Phase 1 rails proof
page remains at `/proof.html`.

## Deploy (Render)

`render.yaml` in this repo is a complete Render blueprint: one web
service, `npm install` → `npm start`, health check on `/api/health`. In
Render: **New → Blueprint → connect this repo**. Set the PayPal Sandbox
values it asks for (`PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`); the mandate
signing secret is generated for you. That is the whole connection — the
server serves the app and the API on one origin, and the front-end's only
configuration is the single `API_BASE` at the top of `public/app.js`
(default: same origin).

## Tests

```bash
npm test   # 30 tests: PayPal client (stubbed API), mandates, audit chain,
           # identity, wallets/sweep, risk holds, guidelines generator
```

## Layout

- `src/paypal.js` — PayPal REST client (OAuth, Orders, Payouts, webhook verify, read-backs)
- `src/mandates.js` · `src/audit.js` · `src/identity.js` — the Trust Foundation (signed mandates, hash-chained ledger, owners/agents/passports)
- `src/wallets.js` — agent wallets: gated spend, held jobs, Live-mode sweep, P&L
- `src/risk.js` · `src/guidelines.js` — borderline holds + plain-English guidelines → signed mandates
- `src/server.js` — the server: app + API, one origin, env-only config
- `public/` — the product front-end (`index.html`, `app.js`, `app.css`) + `proof.html`
- `docs/` — design & buildout, storyboards, API contract, processing/launch/testing breakdown
- `evidence/` — per-phase verification records
- `scripts/prove-live.js` — scripted live proof, writes `evidence/live-run-*.json`
- `render.yaml` — one-tap Render deploy blueprint

## The API

See `docs/api-contract.md`. Highlights: `GET /api/overview` feeds the
console; `POST /api/guidelines/sign` turns words into a mandate;
`POST /api/wallets/:agentId/spend` returns `pass | hold | block`;
`POST /api/jobs/:id/verify-delivery` releases earnings and sweeps.

## Money rules (enforced from day one)

- **No valid signed mandate = no capture.** Altered, revoked, or expired mandates fail validation; hard limits are code, never model output.
- Nothing is recorded as done until its state is **read back from PayPal**; payout calls carry idempotency keys so a retry cannot pay twice.
- Agents stop at zero — a wallet can never reach the owner's other money.
- Credentials live only in env / a local git-ignored `.env`. Never commit them.

## License

MIT — see `LICENSE`.
