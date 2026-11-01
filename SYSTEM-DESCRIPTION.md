# PayPortal — The Complete System: How It Works, Its Functions, and How It Connects

Everything in one document. The code is the whole repository
(github.com/estibancreations-svg/Paypal_Portal and the accompanying zip).
This document describes the system a UI will be built against: what it
does, how a request travels through it, what every module and endpoint
does, the rules that are enforced, and exactly how a front-end connects.

---

## 1. What the system is

PayPortal is a payment layer for virtual worlds and AI agents, built on
PayPal's APIs (free Sandbox). Three capabilities:

1. **In-world pay** — a person buys inside a virtual world (the demo
   venue is a cruise ship, "ShipWorld"); the payment captures on PayPal
   and splits by payout to the venue and the local operator.
2. **Agent wallets** — an AI agent holds a wallet that is a sub-ledger of
   its owner's account. It can spend only inside a signed permission (a
   mandate), it can earn from jobs, and in Live mode it sweeps everything
   above its operating cap to the owner.
3. **Owner governance** — the owner writes rules in plain English, signs
   them into mandates, sees every movement, approves or denies borderline
   spends, and can revoke any mandate instantly (the kill switch).

One rule governs everything: **no valid signed mandate = no capture.**

## 2. How it works, end to end

1. **Intake.** A request comes from one of three doors: a person buying
   in a world, an agent proposing a payment or taking a job, or the
   owner acting in the console. Each request states who, for whom, and
   what money movement (integer cents, merchant, purpose).
2. **The mandate gate (deterministic code).** Signature checked first —
   the mandate is a cryptographically signed document (canonical JSON +
   HMAC-SHA256); changing any field voids it. Then status (revoked =
   dead), expiry, and scope: per-purchase cap, daily cap (today's spend
   summed from the ledger), currency, merchant allowlist.
3. **The risk check.** A proposal that passes the gate can still be
   borderline: above the owner's everyday threshold, a first payment to
   a merchant, or unusual frequency. Borderline = HELD in the owner's
   approval queue with a plain-English reason. No money moves while
   held. Approval re-runs the full mandate gate at that moment (a
   mandate revoked while waiting still blocks). Denial is final. The
   risk check can never approve or widen anything — it can only hold.
4. **Money movement (PayPal rails only).** A passed spend becomes a
   PayPal Order → approval → capture. Splits fire as a Payouts batch
   with an idempotency key (a retry cannot pay twice). Every capture
   and payout is **read back from PayPal** before it is recorded as
   done. Webhooks arrive signature-verified and reconcile against the
   ledger.
5. **Wallets and earnings.** Spends debit only after gate + risk +
   balance checks, in that order; a wallet stops at zero and can never
   touch the owner's other money. Job payments are HELD until delivery
   is verified, then become earnings. In Live mode a release triggers
   the sweep: balance refills to the operating cap, the excess moves to
   the owner. Every effect is a ledger entry (EARN / SPEND / SWEEP);
   the per-agent P&L (earned / operating spend / swept / net / points
   earned for the owner) is summed from the ledger, never edited.
6. **Points.** Captures mint points: base 5 per $10 on any route;
   PayPortal-route boost +2 per $10 (Member) or +3 (Premium /
   Enterprise); +25 per $100 of route spend in a rolling 30 days
   (voyage bonus). Points exist only against a capture ID. Refunds
   claw back proportionally. Redemption is in-system only, never cash
   out. No boost on same-owner internal transfers. (Engine completes
   in the current sprint; the P&L points hook is already live.)
7. **Audit.** Every step above appends to a hash-chained, append-only
   ledger: each entry carries the previous entry's hash, so altering
   history breaks the chain and verification names the exact entry.
   This chain is the system's evidence.

**Failure behavior.** PayPal errors surface with status and stop the
movement (no partial writes). Money-call retries reuse idempotency
keys. Revocation needs no restart and no cache flush.

## 3. Modules and their functions (src/)

| File | Function |
|---|---|
| `src/paypal.js` | PayPal REST client: OAuth client-credentials (token cached), Orders create / authorize / capture / get, capture read-back extraction, Payouts create (idempotency key = sender batch id) + batch/item read-backs, webhook signature verification. Errors surface as `PayPalError` with status + body. |
| `src/config.js` | Env loading (`.env` + process env). Keys: `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_MODE` (`sandbox` \| `live`), `PAYPAL_WEBHOOK_ID`, `PROOF_RECIPIENT_EMAIL`, `MANDATE_SIGNING_SECRET`, `PORT`. Nothing else configures the system; no host or credential is hard-coded. |
| `src/canonical.js` | Canonical JSON serialization + SHA-256 / HMAC-SHA256 helpers. The same payload always produces the same signature and audit hash on any machine. |
| `src/mandates.js` | The mandate engine. `createMandate` (field rules: owner+agent+passport binding, caps in cents, allowlist sorted, tier, expiry, optional everyday threshold + sweep threshold), `verifyMandateSignature`, `isExpired`, `evaluateProposal` (deterministic scope check with written reasons), `MandateRegistry` (`issue`, `get`, `list`, `revoke` = kill switch, `validate`, `authorize` = validate + scope in one call). There is deliberately **no transfer function**. |
| `src/audit.js` | `AuditChain`: `append(event)` (hash-chained), `headHash()`, `verify()` (recomputes the chain, reports the first altered entry), JSON export/import. |
| `src/identity.js` | `IdentityRegistry`: `registerAgent` (bound to one owner), `issuePassport` (per owner, per tier), `revokePassport`, `ownsAgent`, list methods. Passports are non-transferable by design; `transferPassport()` exists only to refuse, with the reason. |
| `src/wallets.js` | `WalletEngine`: `createWallet` (refuses a mandate issued to a different agent), `spend` (gate → risk → balance → debit; holds never debit), `approveHold` / `denyHold`, `createJob` / `verifyDelivery` (HELD → RELEASED; double verification refused), `sweepIfLive` (refill to cap, excess to owner), `recordPoints`, `pnl` (per-agent profit-and-loss), `spentTodayCents`, `knownMerchants`, list methods. |
| `src/risk.js` | `RiskService.evaluate(mandate, proposal, context)` → `pass` or `hold` with reasons: above everyday threshold (owner-set, default 75% of the per-purchase cap), first payment to a merchant, proposals-per-hour velocity. |
| `src/guidelines.js` | `parseGuideline(text)` — plain English → structured draft (caps, threshold, allowlist, expiry: "until New Year" / "for N days" / ISO date; tier; purpose). Fields the words do not state come back as `missing`, never invented. `draftToMandateFields` (refuses incomplete drafts), `renderGuideline(payload)` — a signed mandate read back in plain English. |
| `src/server.js` | The HTTP server (Node, zero dependencies). Serves the app and the API on one origin, holds the engines in memory, wires every action into the audit chain, and exposes all endpoints in §4 plus the demo seed and the console overview feed. |
| `scripts/prove-live.js` | Headless live proof: payout → read back; order → approval URL; `npm run prove -- <ORDER_ID>` captures + reads back. Writes `evidence/live-run-*.json`. |
| `public/` | The reference front-end: `index.html`, `app.js`, `app.css` (the 10 pages, live on the API) and `proof.html` (Phase 1 rails proof). **A new UI replaces this folder wholesale** — see §5. |
| `test/` | 30 automated tests across the PayPal client (stubbed API), mandates, audit, identity, wallets/sweep, risk holds, guidelines. `npm test`. |
| `docs/` | Design & buildout, storyboards (journeys, devices, board), API contract, processing/launch/testing breakdown. |
| `evidence/` | Per-phase verification records with test counts and live-run results. |

## 4. The API (what a UI calls)

Base: same origin as the pages. All bodies JSON; money is integer
cents; errors are `{ "error": "…" }` with an HTTP status. Full detail:
`docs/api-contract.md`.

- **System:** `GET /api/health` · `GET /api/overview` (the console
  feed: agents, passports, mandates with validation + read-back,
  wallets with P&L, pending holds, jobs, audit status + recent
  entries) · `POST /api/demo/seed` (a complete demo state, one call) ·
  `GET /api/audit`.
- **Identity:** `POST /api/agents` · `POST /api/passports`.
- **Mandates:** `POST /api/mandates` · `GET /api/mandates/:id` ·
  `POST /api/mandates/:id/revoke` · `POST /api/mandates/:id/authorize`.
- **Wallets:** `POST /api/wallets` · `GET /api/wallets/:agentId` ·
  `POST /api/wallets/:agentId/spend` → `{ decision: "pass" | "hold" |
  "block", reasons, balanceCents?, holdId? }` · `POST /api/jobs` ·
  `POST /api/jobs/:id/verify-delivery` → `{ job, balanceCents, sweep }`.
- **Guidelines & holds:** `POST /api/guidelines/draft` ·
  `POST /api/guidelines/sign` · `GET /api/holds` ·
  `POST /api/holds/:id/approve` · `POST /api/holds/:id/deny`.
- **PayPal rails:** `POST /api/proof/order` (→ approve URL) ·
  `POST /api/proof/order/:id/capture` · `GET /api/proof/order/:id` ·
  `POST /api/proof/payout` · `POST /api/webhooks`. Without Sandbox
  credentials in env these return a 503 that says exactly that.

## 5. How a front-end connects (the contract for the new UI)

- **One connection point.** Every call goes through `API_BASE`, defined
  once at the top of `public/app.js`. Default `''` = same origin (the
  server serves pages + API together). To host a new UI elsewhere, set
  `window.PAYPORTAL_API_BASE` to the server origin before the script
  loads, or change that one line. Nothing else names a host.
- **State comes from `GET /api/overview`** — one fetch renders every
  console page; actions are the POSTs in §4; re-fetch overview after
  any action.
- **The 10 pages the UI must cover:** Console Dashboard · Approval
  Queue · Agent Wallets · Mandates · Guidelines Generator · In-World
  Pay (ShipWorld) · Points & Passport · Tenants & Tiers · Security &
  Honesty · Judge Mode (a 4-step guided run: sign → spend → hold/deny
  → earn/sweep, showing live IDs). Their content, journeys, and device
  layouts are specified in `docs/design-buildout.md` and the storyboard
  files in `docs/`.
- **Decisions the UI must surface honestly:** a spend result is
  pass / hold / block with `reasons` — show them verbatim; a hold has
  debited nothing; PayPal-dependent actions report the 503
  configuration error until Sandbox env is set.

## 6. Run and deploy

```bash
cp .env.example .env   # MANDATE_SIGNING_SECRET required;
                       # PAYPAL_CLIENT_ID / PAYPAL_SECRET for live captures
npm install            # zero dependencies
npm start              # http://localhost:8080 — app at /, proof at /proof.html
npm test               # 30 tests
```

Deploy: `render.yaml` is a complete Render blueprint (one web service,
health check `/api/health`, signing secret generated, PayPal values set
in Render's dashboard, never in git). State is in-memory in this
prototype: a restart clears demo state (the demo seed rebuilds it in
one call); the engines are storage-agnostic behind their class APIs.

## 7. Status, plainly

Built and verified: PayPal client with read-backs · signed mandates ·
hash-chained audit · identity · agent wallets with held jobs and the
Live sweep · risk holds · guidelines generator · the full API ·
reference front-end (30/30 tests, per-phase records in `evidence/`).
Completing in the current sprint: points mint-on-capture engine,
WebXR scene, tenant engine. Awaiting the owner only: Sandbox
credentials in env for the live capture proof, and the deploy
connection. License: MIT.
