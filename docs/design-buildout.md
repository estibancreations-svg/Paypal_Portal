# PayPortal — Design & Buildout (complete)

The full design of the system, surface by surface: what each part is, its
screens and components, the rules it enforces, and the phase that builds it.
Companion visuals: `docs/storyboard.html` (UI storyboard + flow charts).
Status key: ✅ built & verified · 🔶 in build · 🗺 designed, phase scheduled.

Build windows (full steam, set Oct 30 2026): Phase 3 closes Sat Oct 31 ·
Phases 4–6 Nov 3–5 · Phases 7–8 Nov 6–8 · Phase 9 freeze Nov 9 · Phase 10
video + submission Nov 10 · buffer Nov 11 · **deadline Thu Nov 12, 2026,
2:00 PM CST**.

---

## Foundation — the Trust Stack ✅ (Phase 2)

The layer everything stands on. Five layers:

1. **PayPal rails** — passkeys, tokenization, fraud monitoring, PCI DSS,
   Purchase Protection. Agents never see raw payment credentials (Sandbox in
   the demo; production posture documented on the Security page).
2. **Identity** — owners, agents, passports. An agent is software registered
   to exactly one owner; a passport is issued per owner per tier and is
   **non-transferable by design** (no transfer function exists in the code —
   the only path is revoke + re-issue). `src/identity.js`
3. **Signed mandates** — every permission is a cryptographically signed
   document (canonical JSON + HMAC-SHA256): owner, agent, passport, purpose,
   per-purchase cap, daily cap, currency, allowlist, expiry, tier, sweep
   rule. Alter any field and the signature breaks. `src/mandates.js`,
   `src/canonical.js`
4. **Real-time enforcement** — validation happens at the moment of spend:
   signature → revocation → expiry → scope. Revocation (the kill switch) is
   effective immediately because validation consults the registry every time.
5. **Tamper-evident ledger** — an append-only, hash-chained audit log. Every
   action in the system writes an entry; `verify()` recomputes the chain and
   names the exact entry where history was altered. Only chain-head hashes
   would ever be anchored publicly — never names or amounts. `src/audit.js`

**The system's one-line rule: no valid signed mandate = no capture.**

---

## Level 1 — In-World Pay + ShipWorld 🔶 (Phase 7, Nov 6–8)

**What it is.** A WebXR world (one URL: Quest Browser, Vision Pro, desktop
Chrome) where a person buys with PayPal without leaving the scene. The demo
anchor tenant is **ShipWorld**, a cruise ship: a passenger books a
shore excursion at the in-world desk.

**Screens / components**
- The scene: ship deck + excursion desk (A-Frame/Three.js), product cards
  fed by a catalogue (name, price, operator — the AI never sets prices).
- **Concierge**: an AI guide that presents the item, states the total, and
  takes a voice/gaze confirmation. It proposes and explains; it cannot move
  money.
- **Confirm sheet**: item, total, route ("PayPortal route — points boost
  applies"), PayPal approval step.
- **Receipt card** (in-world + mirrored in the console): capture ID, the
  **split** — cruise line share and local operator share paid out via
  PayPal Payouts — and points earned.

**Rules.** Order is created only after confirmation; capture is read back
from PayPal before the receipt shows "paid"; the split fires as a Payouts
batch with an idempotency key; points mint only against the capture ID.

**APIs.** PayPal Orders (create → approve → capture + read-back), Payouts
(split), Webhooks (async status). Client: `src/paypal.js` ✅.

---

## Level 2 — Agent Wallets ✅ (Phase 3)

**What it is.** A dedicated wallet per AI agent: a sub-ledger of the
owner's account under a signed mandate. The agent can spend inside its
mandate, earn from jobs, pay its own operating costs, and — in Live mode —
sweep everything above its operating cap to the owner.

**Screens / components** (in the console)
- **Wallet card**: balance vs operating cap, Live-mode toggle state, tier,
  mandate summary, kill switch.
- **P&L panel**: Earned / Operating spend / Swept to owner / Net / Points
  earned for owner.
- **Jobs list**: HELD → RELEASED states with the delivery-verification
  action.
- **Ledger**: every EARN / SPEND / SWEEP entry, chained into the audit log.

**Rules.** Gate first, balance second, debit last. Blocked decisions never
debit. The agent stops at zero — it can never touch the owner's other
money. Job money is held until delivery is verified; double verification
is refused. `src/wallets.js` ✅ (21/21 tests incl. sweep math).

---

## Level 3 — Guardrail Console + Guidelines Generator 🔶 (Phases 4–5, Nov 3–5)

**What it is.** The owner's control room (AG Grid tables), and the front
door to the whole system: the owner writes rules in plain English, the AI
drafts them into a policy, the owner signs — and the signed policy *becomes*
the enforced mandate.

**Screens / components**
- **Dashboard**: wallets, balances, today's spend vs caps, points.
- **Transactions grid**: live money movement with PayPal IDs and read-back
  status.
- **Approval queue**: borderline proposals (inside hard caps, above the
  everyday threshold, or unusual pattern) wait here with the risk service's
  plain-English reason; owner approves or denies; a denial is final.
- **Audit view**: the hash-chained log with a one-tap "verify chain" result.
- **Guidelines Generator**: plain-English input → structured draft
  (caps, allowlist, expiry, sweep) → owner edits → **sign** → mandate
  issued by the Phase 2 engine.
- **Kill switch**: on every wallet and mandate card; one tap revokes.
- **Security / Honesty pages**: the Trust Stack, and what is built vs
  roadmap — labelled plainly.

**Rules.** Hard limits are deterministic code; the AI proposes and
explains, signed rules decide. The risk service (Phase 4) can hold a
proposal for approval, but it can never raise a cap or widen an allowlist.

---

## Level 4 — Anchor Tenants & Tiers 🔶 (Phase 8, Nov 6–8)

**What it is.** The same passport works across venues. A **tenant** (a
cruise line in the demo) configures its own catalogue, split rules, and
points campaigns on top of the shared mandate/audit core.

**Tiers** — Observer (base points, read-only), Member (+2 boost),
Premium / Enterprise (+3 boost, higher caps, white-label options as the
post-hackathon business model). Airline-scale tenancy is the documented
roadmap anchor; the cruise is what the demo builds.

**Screens / components**: tenant switcher in the console; per-tenant
catalogue + split configuration; tier templates that pre-fill mandate
drafts in the Guidelines Generator.

---

## Points — across all levels 🔶 (Phase 6, Nov 3–5)

**The rules (Steve's design, locked).** Base on any route: **$10 captured
= 5 points**. PayPortal route boost: **+2 per $10 (Member)**, **+3 per $10
(Premium/Enterprise)** — 7 or 8 total. Voyage bonus: +25 per $100 of
PayPortal-route spend in a rolling 30 days.

**Screens / components**: balance + tier progress on the passport card;
earn toast at capture; redemption step inside in-world checkout
(in-system only, never cash-out); per-agent points on the wallet P&L.

**Rules.** Points mint **only against a captured PayPal transaction ID**,
recorded in the audit ledger. Refunds claw back proportionally. No boost
on same-owner internal agent transfers (anti-wash). Daily boost cap per
wallet. Agent-earned points accrue to the **owner**.

---

## Cross-cutting design

**Data model.** owners · passports · agents · mandates · wallets ·
ledger (EARN/SPEND/SWEEP) · jobs · orders · payouts · points_ledger ·
tenants · risk_decisions · approvals · audit_chain. Money is integer
cents everywhere; no floats touch money.

**Money rules (non-negotiable).** (1) No capture without a valid signed
mandate triple-match. (2) Hard limits are code, never model output.
(3) Every money movement is read back from PayPal before it is recorded
as done. (4) Points mint only against a capture ID. (5) Agents stop at
zero.

**Phase map.** 0 accounts ✅ · 1 rails ✅ (live credential proof pending
Steve's Sandbox keys — blocks nothing) · 2 trust foundation ✅ ·
3 agent wallets ✅ · 4 risk + guidelines · 5 console · 6 points ·
7 world + ShipWorld · 8 tenants + tiers · 9 Judge Mode + evidence
(freeze Nov 9) · 10 video + submit (Nov 10).

**Demo spine (the 7 steps the video shows).** Sign a guideline → in-world
buy with split + boosted points → child-wallet hold at the borderline →
agent books inside its mandate → over-limit attempt blocked → job earning
released, refill-to-cap, sweep to owner → kill switch stops a wallet cold.
