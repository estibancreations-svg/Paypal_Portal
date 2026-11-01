# PayPortal — Breakdown: Processing · Launch · Testing

Written Oct 30, 2026, under Steve's compressed order: **4 days max, then
launch to test** — build Oct 31–Nov 3, launched in a testable state Tue
Nov 3, then Nov 4–12 for testing, fixes, the demo video, and submission.
The Devpost deadline (Thu Nov 12, 2026, 2:00 PM CST) is the fixed outer
wall; the final submit tap stays Steve's. This breakdown supersedes the
old Nov 3–8 phase windows. The flow charts in `docs/storyboard.html` are
the visual companion to §1.

Status at the start of the 4 days: Phases 1–3 are built and verified
(rails proof code, trust foundation, agent wallets — 21/21 tests, public
repo live). The remaining scope is Phases 4–9.

---

## 1 · Processing — how the system processes, end to end

Every request in PayPortal travels one pipeline. There is no side door.

**1.1 Intake.** A request arrives from exactly three doors: the WebXR
world (a person buying), an agent (a payment proposal or a job), or the
console (the owner's own actions). Each request names who is acting, for
whom, and what money movement is proposed — amount in integer cents,
merchant or category, purpose.

**1.2 Identity & mandate check (the gate).** Before anything else, the
mandate engine validates: the actor is registered to the owner; the
mandate's signature is intact (any altered field fails); the mandate is
not revoked and not expired; the proposal sits inside scope —
per-purchase cap, daily cap (today's spend is summed from the ledger),
currency, allowlist. Outcomes: **pass**, **block** (hard failure — reason
recorded, nothing debits), or, once the risk service lands in Phase 4,
**hold** for borderline proposals (inside hard caps, above the everyday
threshold or off-pattern) which wait in the owner's approval queue.
A denial is final; an approval is single-use for that proposal.

**1.3 Money movement (PayPal rails only).** A passed spend becomes a
PayPal Order → buyer/agent approval → capture. The split (in-world
purchases) fires as a Payouts batch with an idempotency key so a retry
can never pay twice. **Read-back rule:** the capture or payout is fetched
back from PayPal and only a read-back-confirmed status is written into
the ledger as done. Webhooks are signature-verified and reconciled
against the same ledger.

**1.4 Wallet bookkeeping.** Agent spends debit the wallet only after the
gate passes; the wallet can hit zero and stop, never below. Job payments
enter as HELD and convert to EARN only on delivery verification. In Live
mode, a release triggers the sweep calculation: balance above the
operating cap is moved to the owner as a SWEEP entry (and a Payouts call
in the live server). Every step appends EARN / SPEND / SWEEP entries the
P&L is summed from — the P&L is never edited, only derived.

**1.5 Points.** On a confirmed capture, the points engine mints: base
5 per $10; PayPortal-route boost +2 (Member) or +3 (Premium/Enterprise)
per $10, subject to the daily boost cap and the anti-wash rule (no boost
on same-owner internal transfers); voyage bonus +25 per $100 of route
spend in a rolling 30 days. Minting records the capture ID — points do
not exist without one. A refund webhook triggers a proportional
clawback. Redemption is a checkout step inside the system only.

**1.6 Audit.** Steps 1.2–1.5 each append a hash-chained entry
(proposal, decision + reason, PayPal IDs, ledger effects). The chain
verifies end-to-end on demand; an altered entry fails verification at
its exact position. This chain is the evidence the Judge Mode page and
the submission cite.

**1.7 Failure handling.** PayPal API errors surface with status and body
and stop the movement (no partial ledger writes). Retries of money calls
reuse idempotency keys. A revoked mandate mid-flow blocks the next
validation — the kill switch needs no restart and no cache flush.

---

## 2 · Launch — the 4-day push (Oct 31 – Nov 3)

One gate per day: the day's work must pass its tests before the next
day starts. Anything that fails its gate is cut or fixed that day —
the launch date does not move.

**Day 1 — Sat Oct 31: Risk + Guidelines + Console core (Phases 4–5a).**
Risk service (borderline → hold with reason; hard limits stay code) and
the approval queue working end to end; Guidelines Generator (plain
English → structured draft → signed mandate via the Phase 2 engine);
console pages: Dashboard, Approval Queue, Wallets, Mandates (the device
storyboard layouts). *Gate: full test suite green + a scripted
sign-a-guideline → hold → approve → capture run over the API.*

**Day 2 — Sun Nov 1: Console complete + Points (Phases 5b–6).**
Transactions and audit views (one-tap chain verify), Security and
Honesty pages; points engine (mint-on-capture, boost tiers, voyage
bonus, clawback, redeem step) wired to captures and to the wallet P&L.
*Gate: points scenario test — buy $85 on the route at Premium, expect
68 points; refund it, expect the clawback.*

**Day 3 — Mon Nov 2: World + Tenants (Phases 7–8).**
The WebXR ShipWorld scene (desktop-first fallback guaranteed), product
cards from the tenant catalogue, concierge confirm, capture + Payouts
split + receipt; tenant/tiers configuration (ShipWorld active, tier
templates feeding the Guidelines Generator). *Gate: the full demo spine
run in the browser without a headset: sign → buy → split → points.*

**Day 4 — Tue Nov 3: Judge Mode + evidence + LAUNCH TO TEST (Phase 9).**
Judge Mode page (4 guided steps with live IDs), evidence pack assembled
from the audit chain and test runs, README brought current, hosting
deployed. **End of Day 4 the system is launched in a testable state** —
every surface reachable, every flow runnable, issues list opened.

## 3 · Testing — Nov 4–12

**3.1 What gets tested, in order.**
(1) **Money-path tests** — the automated suite (21 tests today; grows
with each phase) runs on every change: gate blocks, stop-at-zero,
sweep math, points/clawback, chain verification.
(2) **Demo-spine rehearsals** — the 7-step spine end to end in the real
deployed build, timed against the 3-minute video budget.
(3) **Judge-walk tests** — a fresh-eyes pass through Judge Mode and the
console on desktop, tablet, and mobile layouts (the device storyboards
are the checklist: same content, decision first on small screens).
(4) **Failure drills** — revoked mandate mid-flow, tampered mandate,
PayPal error responses, double delivery verification, webhook replay.
(5) **Evidence audit** — every claim in the submission write-up traced
to a test, an evidence file, or a read-back ID; placeholders filled
only from real runs.

**3.2 Exit checks (the bar for "tested").** Suite green on the deployed
build; spine runs clean three times in a row; Judge Mode completable
by someone who has never seen the system; no known blockers in the
issues list; the demo stays live and free through judging (Dec 21).

**3.3 How issues get fixed inside the window.** Issues are filed the
moment they surface, ranked money-path first, demo-spine second,
cosmetics last. Fixes ship in small commits with the failing test added
first. **Freeze rules:** Nov 9 — feature freeze (fixes only). Nov 10 —
demo video recorded on the frozen build + submission assembled from the
Answers document. Nov 11 — buffer and final check of every link.
**Nov 12, 2:00 PM CST — deadline; Steve's submit tap.** Cut order if
time squeezes (never cut): mandate enforcement, the block demo, the
sweep, Judge Mode, evidence. Cut first: extra world dressing, extra
tenants beyond ShipWorld, cosmetic polish.
