# PayPortal

The payment passport for virtual worlds and AI agents — pay inside worlds, let
agents pay **and earn** under signed mandates their owner controls, and govern
every cent. All money movement runs on PayPal's APIs in the free Sandbox.

> Status: Phases 1–4 built and tested (rails proof · trust foundation ·
> agent wallets · risk service + guidelines generator). Points, the console
> UI, and the WebXR world complete the sprint to the Nov 3 test launch.
> Design + storyboards: see `docs/`.

## Run the Phase 1 proof

Requirements: Node.js 20+, a free PayPal Developer Sandbox app.

```bash
cp .env.example .env   # add the Sandbox app Client ID + Secret (server-side only)
npm start              # http://localhost:8080
```

Open the page: create an order → approve it as the Sandbox buyer → capture and
read back → send a payout and read it back. Every result shown is read back
from PayPal, not taken from the request response.

Headless variant:

```bash
npm run prove            # payout proof + creates an order, prints approval URL
npm run prove -- <ORDER_ID>   # after buyer approval: capture + read back
```

## Tests

```bash
npm test   # client behaviour against a stubbed PayPal API (no credentials needed)
```

## Layout

- `src/paypal.js` — PayPal REST client (OAuth, Orders, Payouts, webhook verify, read-backs)
- `src/server.js` — bare Phase 1 proof server (zero dependencies)
- `src/config.js` — env loading
- `public/index.html` — the bare proof page
- `scripts/prove-live.js` — scripted live proof, writes `evidence/live-run-*.json`
- `test/` — automated tests
- `evidence/` — recorded proof runs (IDs + read-back statuses)

## Money rules (enforced from day one)

- Nothing is recorded as done until its state is **read back from PayPal**.
- Mutating payout calls carry an idempotency key so a retry cannot pay twice.
- Credentials live only in a local, git-ignored `.env`. Never commit them.

## License

MIT — see `LICENSE`.
