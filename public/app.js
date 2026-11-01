// PayPortal app — the working product front-end (vanilla JS, no build step).
//
// ============ THE ONE CONNECTION POINT ============
// Every API call in this app goes through API_BASE. It defaults to ''
// (same origin) because the PayPortal server serves these pages and the
// API together. To point the pages at a different host, set
// window.PAYPORTAL_API_BASE before this script loads — or change this
// one line. Nothing else in the app names a host. The contract for every
// endpoint used here lives in docs/api-contract.md.
const API_BASE = window.PAYPORTAL_API_BASE ?? '';

async function api(path, opts = {}) {
  const res = await fetch(API_BASE + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) });
const $ = (sel, el = document) => el.querySelector(sel);
const money = (c) => '$' + (c / 100).toFixed(2);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const short = (id) => (id ? id.slice(0, 8) + '…' : '—');

const NAV = [
  ['dashboard', 'Dashboard'], ['queue', 'Approval Queue'], ['wallets', 'Agent Wallets'],
  ['mandates', 'Mandates'], ['guidelines', 'Guidelines'], ['world', 'ShipWorld'],
  ['points', 'Points & Passport'], ['tenants', 'Tenants & Tiers'], ['security', 'Security'],
  ['judge', 'Judge Mode'],
];
const state = { overview: null, health: null, error: null };
const judge = {};
const GUIDELINE_TEXT = 'My concierge may book port tours and cafes, at most $50 at a time and $150 a day, only at Harbor Tours and Port Cafe, until New Year. Anything above $30 without asking is too much.';
const CATALOG = [
  { name: 'Snorkel Reef Trip', price: 85, operator: 'Reef Tours Co.' },
  { name: 'Sunset Sail', price: 120, operator: 'Harbor Sails' },
  { name: 'Reef Photo Pack', price: 25, operator: 'Shutter Reef' },
];

async function refresh() {
  try {
    state.health = await api('/api/health');
    state.overview = await api('/api/overview');
    state.error = null;
  } catch (err) {
    state.error = err.message;
  }
  renderHealth();
}

function renderHealth() {
  const text = state.error
    ? 'API setup needed: ' + esc(state.error)
    : `Server live · PayPal sandbox: <b>${state.health?.configured ? 'connected' : 'not connected (env)'}</b>`;
  const h1 = $('#health'); if (h1) h1.innerHTML = text;
  const h2 = $('#health-mini'); if (h2) h2.innerHTML = text;
  const holds = state.overview?.holds?.length || 0;
  $('#nav').innerHTML = NAV.map(([id, label]) =>
    `<a href="#/${id}" data-route="${id}">${label}${id === 'queue' && holds ? `<span class="badge">${holds}</span>` : ''}</a>`).join('');
  $('#bottombar').innerHTML = '<div class="bnav">' + ['dashboard', 'queue', 'wallets', 'judge'].map((id) => {
    const label = NAV.find(([n]) => n === id)[1];
    return `<a href="#/${id}" data-route="${id}">${label}${id === 'queue' && holds ? `<span class="badge">${holds}</span>` : ''}</a>`;
  }).join('') + '</div>';
}

function route() {
  const id = (location.hash.replace('#/', '') || 'dashboard').split('?')[0];
  document.querySelectorAll('[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === id));
  const page = $('#page');
  if (state.error && !state.overview) {
    page.innerHTML = `<h1>One setup step remains</h1><div class="banner block">${esc(state.error)}</div>
    <p class="sub">The server needs its environment set (see <span class="mono">.env.example</span>): a mandate signing secret, and — for live PayPal captures — the Sandbox app credentials. Everything else on this page is ready.</p>`;
    return;
  }
  const render = PAGES[id] || PAGES.dashboard;
  page.innerHTML = render();
  bind(page);
  window.scrollTo(0, 0);
}

const agentName = (id) => state.overview?.agents.find((a) => a.id === id)?.name || short(id);
const mandateOf = (wallet) => state.overview?.mandates.find((m) => m.payload.id === wallet.mandateId);

function dashboard() {
  const o = state.overview;
  const totalBalance = o.wallets.reduce((s, w) => s + w.wallet.balanceCents, 0);
  const totalPoints = o.wallets.reduce((s, w) => s + (w.pnl?.pointsEarnedForOwner || 0), 0);
  const recent = o.audit.recent.map((e) => `<tr><td class="mono">#${e.seq}</td><td>${esc(e.event.type)}</td><td class="mono">${short(e.hash)}</td></tr>`).join('');
  return `<h1>Console Dashboard</h1><p class="sub">Every wallet, hold, and point — one glance. All figures below are live from the server.</p>
  ${o.agents.length === 0 ? `<div class="banner info">Nothing here yet. <b>Load the demo data</b> to see the whole system alive — an agent, a signed mandate, a funded wallet, a held job, and a proposal waiting in the queue.<br><br><button class="btn" data-act="seed">Load demo data</button></div>` : ''}
  <div class="grid">
    <div class="card"><h3>Agent wallets</h3><div class="stat">${o.wallets.length}</div><div class="kv"><span>Total operating balance</span><b>${money(totalBalance)}</b></div><div class="kv"><span>Agents registered</span><b>${o.agents.length}</b></div></div>
    <div class="card"><h3>Waiting on you</h3><div class="stat">${o.holds.length}</div><p>Held proposals in the <a href="#/queue">approval queue</a>. Nothing held can move without your decision.</p></div>
    <div class="card"><h3>Points earned for owners</h3><div class="stat">${totalPoints}</div><p>Across all agent wallets (live P&amp;L hook — see Points &amp; Passport).</p></div>
    <div class="card"><h3>Audit chain</h3><div class="stat">${o.audit.verify.ok ? 'Verified ✓' : 'BROKEN'}</div><div class="kv"><span>Entries</span><b>${o.audit.count}</b></div><div class="kv"><span>Head hash</span><span class="mono">${short(o.audit.verify.headHash)}</span></div></div>
  </div>
  <div class="card" style="margin-top:14px"><h3>Latest audit entries</h3><table>${recent || '<tr><td>No entries yet.</td></tr>'}</table></div>`;
}

function queue() {
  const o = state.overview;
  const cards = o.holds.map((h) => `<div class="card">
    <h3>${money(h.proposal.amountCents)} · ${esc(h.proposal.merchant || h.proposal.category || 'payment')}</h3>
    <div class="kv"><span>Agent</span><b>${esc(agentName(h.agentId))}</b></div>
    <div class="kv"><span>Hold ID</span><span class="mono">${short(h.id)}</span></div>
    <p>${h.reasons.map((r) => `<span class="chip warn">${esc(r)}</span>`).join('')}</p>
    <p class="sub">No money has moved. Approval re-checks the mandate at that moment; denial is final.</p>
    <button class="btn" data-act="approve" data-id="${h.id}">Approve once</button>
    <button class="btn ghost" data-act="deny" data-id="${h.id}">Deny</button>
    <span class="result"></span></div>`).join('');
  return `<h1>Approval Queue</h1><p class="sub">Borderline proposals wait here with the risk service's reason. The decision is yours, and it is recorded in the audit chain either way.</p>
  <div id="qmsg"></div><div class="grid">${cards || '<div class="card"><h3>Queue is clear</h3><p>No proposals are waiting.</p></div>'}</div>`;
}

function wallets() {
  const o = state.overview;
  const cards = o.wallets.map(({ wallet: w, pnl }) => {
    const m = mandateOf(w);
    const allow = m?.payload.allowlist || [];
    const jobs = o.jobs.filter((j) => j.agentId === w.agentId);
    return `<div class="card">
    <h3>${esc(agentName(w.agentId))} <span class="chip ${w.liveMode ? 'good' : ''}">${w.liveMode ? 'Live mode ON' : 'Live mode OFF'}</span></h3>
    <div class="stat">${money(w.balanceCents)} <span style="font-size:13px;color:var(--muted)">/ ${money(w.operatingCapCents)} cap</span></div>
    <div class="kv"><span>Earned</span><b>${money(pnl.earnedCents)}</b></div>
    <div class="kv"><span>Operating spend</span><b>${money(pnl.operatingSpendCents)}</b></div>
    <div class="kv"><span>Swept to owner</span><b>${money(pnl.sweptToOwnerCents)}</b></div>
    <div class="kv"><span>Net</span><b>${money(pnl.netCents)}</b></div>
    <div class="kv"><span>Points for owner</span><b>${pnl.pointsEarnedForOwner}</b></div>
    <label>Try a spend — amount (USD)</label><input type="number" min="1" step="1" value="25" id="amt-${w.agentId}">
    <label>Merchant</label><select id="mer-${w.agentId}">${allow.map((a) => `<option>${esc(a)}</option>`).join('')}<option>Casino (not allowed)</option></select>
    <p style="margin-top:10px"><button class="btn small" data-act="spend" data-id="${w.agentId}">Propose spend</button>
    <button class="btn danger small" data-act="kill" data-id="${w.mandateId}">Kill switch</button></p>
    <div class="spend-result"></div>
    <h3 style="margin-top:14px">Jobs</h3>
    ${jobs.map((j) => `<div class="kv"><span>${esc(j.title)} · ${money(j.amountCents)}</span><b>${j.status}</b></div>${j.status === 'HELD' ? `<button class="btn small" data-act="deliver" data-id="${j.id}">Verify delivery → release + sweep</button>` : ''}`).join('') || '<p class="sub">No jobs yet.</p>'}
    <label>New job — title</label><input id="jobt-${w.agentId}" value="Shore-excursion bookings">
    <label>Amount (USD)</label><input type="number" min="1" step="1" value="12" id="joba-${w.agentId}">
    <p style="margin-top:8px"><button class="btn ghost small" data-act="job" data-id="${w.agentId}">Create held job</button></p>
    </div>`;
  }).join('');
  return `<h1>Agent Wallets</h1><p class="sub">Sub-ledgers of the owner's account, run by agents under signed mandates. Gate first, balance second, debit last — an agent stops at zero.</p><div class="grid">${cards || '<div class="card"><h3>No wallets yet</h3><p>Sign a guideline, then create a wallet under its mandate.</p></div>'}</div>`;
}

function mandates() {
  const o = state.overview;
  const cards = o.mandates.map((m) => `<div class="card">
    <h3>${esc(m.payload.purpose || 'Mandate')} <span class="chip ${m.status === 'ACTIVE' ? 'good' : 'bad'}">${m.status}</span> <span class="chip">${esc(m.payload.tier)}</span></h3>
    <div class="kv"><span>Agent</span><b>${esc(agentName(m.payload.agentId))}</b></div>
    <div class="kv"><span>Caps</span><b>${money(m.payload.perPurchaseCapCents)} / purchase · ${money(m.payload.dailyCapCents)} / day</b></div>
    <div class="kv"><span>Everyday threshold</span><b>${m.payload.everydayThresholdCents ? money(m.payload.everydayThresholdCents) : '75% of cap'}</b></div>
    <div class="kv"><span>Allowlist</span><b>${esc(m.payload.allowlist.join(', ') || 'any')}</b></div>
    <div class="kv"><span>Expires</span><b>${esc(m.payload.expiresAt.slice(0, 10))}</b></div>
    <div class="kv"><span>Validation</span><b>${m.validation.valid ? 'Valid ✓' : 'INVALID: ' + esc(m.validation.reasons.join('; '))}</b></div>
    <p class="sub" style="margin-top:8px">“${esc(m.guideline)}”</p>
    <p class="mono">id ${m.payload.id}</p>
    ${m.status === 'ACTIVE' ? `<button class="btn danger small" data-act="kill" data-id="${m.payload.id}">Revoke (kill switch)</button>` : ''}
  </div>`).join('');
  return `<h1>Mandates</h1><p class="sub">The signed permissions themselves. Alter any field and the signature breaks; revoke and the agent stops instantly.</p><div class="grid">${cards || '<div class="card"><h3>No mandates yet</h3><p>Write a guideline and sign it.</p></div>'}</div>`;
}

function guidelines() {
  const o = state.overview;
  const agentOpts = o.agents.map((a) => `<option value="${a.id}">${esc(a.name)} (owner ${esc(a.ownerId)})</option>`).join('');
  const passOpts = o.passports.map((p) => `<option value="${p.id}">${esc(p.tier)} · ${short(p.id)} · owner ${esc(p.ownerId)}</option>`).join('');
  return `<h1>Guidelines Generator</h1><p class="sub">Write the rules in plain English. The generator drafts exact numbers — and reports anything your words leave out instead of inventing it. Signing turns the draft into an enforced mandate.</p>
  <div class="grid">
    <div class="card"><h3>1 · Who</h3>
      <label>New agent name</label><input id="g-agent-name" value="Concierge">
      <label>Owner ID</label><input id="g-owner" value="owner-1">
      <p style="margin-top:8px"><button class="btn small" data-act="mkagent">Register agent</button></p>
      <label>Passport tier</label><select id="g-tier"><option>MEMBER</option><option>PREMIUM</option><option>ENTERPRISE</option><option>OBSERVER</option></select>
      <p style="margin-top:8px"><button class="btn small" data-act="mkpass">Issue passport</button></p>
      <div id="g-who-result"></div>
      <label>Agent</label><select id="g-agent">${agentOpts || '<option value="">— register one first —</option>'}</select>
      <label>Passport</label><select id="g-pass">${passOpts || '<option value="">— issue one first —</option>'}</select>
    </div>
    <div class="card"><h3>2 · The guideline</h3>
      <textarea id="g-text">${esc(sessionStorage.getItem('guidelinePrefill') || GUIDELINE_TEXT)}</textarea>
      <p style="margin-top:8px"><button class="btn ghost small" data-act="draft">Draft it</button>
      <button class="btn small" data-act="sign">Sign as mandate</button></p>
      <div id="g-result"></div>
    </div>
    <div class="card"><h3>3 · Fund the wallet</h3>
      <label>Mandate</label><select id="g-mandate">${o.mandates.filter((m) => m.status === 'ACTIVE').map((m) => `<option value="${m.payload.id}">${esc(m.payload.purpose || 'Mandate')} · ${short(m.payload.id)}</option>`).join('') || '<option value="">— sign one first —</option>'}</select>
      <label>Operating cap (USD)</label><input type="number" id="g-cap" value="200">
      <label>Opening balance (USD)</label><input type="number" id="g-open" value="200">
      <p style="margin-top:8px"><button class="btn small" data-act="mkwallet">Create wallet</button></p>
      <div id="g-wallet-result"></div>
    </div>
  </div>`;
}

function world() {
  const cards = CATALOG.map((item, i) => {
    const line = Math.round(item.price * 0.7); const op = item.price - line;
    const pts = Math.floor(item.price / 10) * 8;
    return `<div class="card"><h3>${esc(item.name)}</h3><div class="stat">$${item.price}.00</div>
    <div class="kv"><span>Cruise line (70%)</span><b>$${line}.00</b></div>
    <div class="kv"><span>${esc(item.operator)} (30%)</span><b>$${op}.00</b></div>
    <div class="kv"><span>Points on this route (Premium)</span><b>+${pts}</b></div>
    <p style="margin-top:10px"><button class="btn small" data-act="buy" data-i="${i}">Buy with PayPal</button></p>
    <div class="buy-result"></div></div>`;
  }).join('');
  return `<h1>In-World Pay · ShipWorld</h1><p class="sub">The demo tenant's excursion desk. In the headset this page is the WebXR scene (Day 3 of the sprint); here the same purchase runs from the browser. A live capture needs the server's PayPal Sandbox env — without it, the buy button tells you exactly that, and the split + points shown are the configured design.</p>
  <div class="scene"><b>⛴ ShipWorld — Deck 7 Excursion Desk</b><br><span style="color:var(--muted)">Concierge: “Pick a trip and I will state the total. I can present and confirm — I can never move money myself.”</span></div>
  <div class="grid" style="margin-top:14px">${cards}</div>`;
}

function points() {
  const o = state.overview;
  const rows = o.wallets.map(({ wallet: w, pnl }) => `<tr><td>${esc(agentName(w.agentId))}</td><td>${pnl.pointsEarnedForOwner}</td><td>${money(pnl.earnedCents)}</td></tr>`).join('');
  const pass = o.passports.map((p) => `<span class="chip ${p.status === 'ACTIVE' ? 'good' : 'bad'}">${esc(p.tier)} · ${short(p.id)} · ${p.status}</span>`).join(' ');
  return `<h1>Points &amp; Passport</h1><p class="sub">Points mint only against a captured PayPal transaction. Balances here are the live per-agent P&amp;L values; the mint-on-capture engine completes on Day 2 of the sprint.</p>
  <div class="grid">
    <div class="card"><h3>The rules</h3>
      <div class="kv"><span>Any route</span><b>5 pts per $10 captured</b></div>
      <div class="kv"><span>PayPortal route · Member</span><b>+2 per $10 (7 total)</b></div>
      <div class="kv"><span>PayPortal route · Premium / Enterprise</span><b>+3 per $10 (8 total)</b></div>
      <div class="kv"><span>Voyage bonus</span><b>+25 per $100 route spend / 30 days</b></div>
      <div class="kv"><span>Refund</span><b>proportional clawback</b></div>
      <div class="kv"><span>Redemption</span><b>in-system only — never cash out</b></div></div>
    <div class="card"><h3>Passports</h3><p>${pass || 'None issued yet.'}</p>
      <h3 style="margin-top:12px">Points earned by agents, for their owners</h3>
      <table><tr><th>Agent</th><th>Points</th><th>Earned</th></tr>${rows || '<tr><td colspan="3">No wallets yet.</td></tr>'}</table></div>
  </div>`;
}

function tenants() {
  const tiers = [['OBSERVER', 'Base points only · read-only', ''], ['MEMBER', '+2 boost per $10', 'My agent may spend, at most $50 at a time and $150 a day, for 90 days.'], ['PREMIUM', '+3 boost per $10 · higher caps', 'My premium agent may book, at most $200 at a time and $600 a day, for 90 days.'], ['ENTERPRISE', '+3 boost · white-label (roadmap)', '']];
  return `<h1>Tenants &amp; Tiers</h1><p class="sub">One passport, many venues. The cruise is the demo tenant; tier templates pre-fill the Guidelines Generator.</p>
  <div class="grid">
    <div class="card"><h3>ShipWorld Cruises <span class="chip good">ACTIVE TENANT</span></h3>
      <div class="kv"><span>Catalogue</span><b>${CATALOG.length} excursions</b></div>
      <div class="kv"><span>Default split</span><b>70% cruise line · 30% operator</b></div>
      <div class="kv"><span>Points campaigns</span><b>tenant-funded boosts allowed</b></div></div>
    <div class="card"><h3>Tier templates</h3>
      ${tiers.map(([t, desc, tpl]) => `<div class="kv"><span><b>${t}</b> — ${desc}</span>${tpl ? `<button class="btn ghost small" data-act="tpl" data-t="${esc(tpl)}">Use template</button>` : ''}</div>`).join('')}
      <p class="sub" style="margin-top:8px">Airline-scale tenancy is the documented roadmap anchor.</p></div>
  </div>`;
}

function security() {
  const built = ['Signed mandates — tamper breaks the signature', 'Hash-chained audit — alteration located exactly', 'Kill switch — revocation effective at the next check', 'Risk holds with written reasons; denial is final', 'Agent wallets — gate, balance, debit, in that order; stop at zero', 'Held jobs — earnings only on verified delivery', 'Live sweep — refill to cap, excess to the owner', 'Guidelines Generator — missing fields reported, never invented', 'PayPal client — Orders/Payouts with read-backs and idempotent batches', 'This console — every page live against the API'];
  const roadmap = ['Live sandbox capture + payout proof (needs the Sandbox credentials in env)', 'Points mint-on-capture engine (sprint Day 2)', 'WebXR scene build (sprint Day 3)', 'Tenant engine beyond ShipWorld config (sprint Day 3)', 'PYUSD settlement lane', 'On-chain anchoring of audit head hashes (hashes only)', 'Production security certification — Sandbox proves logic, not certification'];
  return `<h1>Security &amp; Honesty</h1><p class="sub">The Trust Stack, and the plain line between what is built and what is roadmap.</p>
  <div class="grid">
    <div class="card"><h3>Built &amp; verified</h3>${built.map((b) => `<p><span class="chip good">BUILT</span> ${esc(b)}</p>`).join('')}</div>
    <div class="card"><h3>Roadmap — labelled as such</h3>${roadmap.map((b) => `<p><span class="chip warn">ROADMAP</span> ${esc(b)}</p>`).join('')}</div>
  </div>`;
}

function judgePage() {
  return `<h1>Judge Mode</h1><p class="sub">Four steps, run live against this server. Every value shown comes back from the API — mandate IDs, decisions, balances, and the audit chain head.</p>
  <div class="grid">
    <div class="card"><h3><span class="stepnum">1</span>Sign a guideline</h3><p>Creates an agent + Premium passport and signs the standard guideline into a mandate.</p><button class="btn small" data-act="j1">Run step 1</button><div id="j1-out" style="margin-top:8px"></div></div>
    <div class="card"><h3><span class="stepnum">2</span>Agent spends inside its mandate</h3><p>Funds a wallet and books $25 at Harbor Tours. A first-payment hold appears — as the owner, you approve it here.</p><button class="btn small" data-act="j2" disabled>Run step 2</button><div id="j2-out" style="margin-top:8px"></div></div>
    <div class="card"><h3><span class="stepnum">3</span>Borderline is held — owner denies</h3><p>A $40 booking sits above the $30 everyday threshold. It waits, and the denial stops it cold.</p><button class="btn small" data-act="j3" disabled>Run step 3</button><div id="j3-out" style="margin-top:8px"></div></div>
    <div class="card"><h3><span class="stepnum">4</span>Agent earns — sweep to owner</h3><p>A $50 job is delivered and verified: earnings refill the wallet to its cap and the excess sweeps to the owner. Ends with the audit chain verified.</p><button class="btn small" data-act="j4" disabled>Run step 4</button><div id="j4-out" style="margin-top:8px"></div></div>
  </div>`;
}

const PAGES = { dashboard, queue, wallets, mandates, guidelines, world, points, tenants, security, judge: judgePage };

function banner(kind, html) { return `<div class="banner ${kind}">${html}</div>`; }

function bind(page) {
  page.querySelectorAll('[data-act]').forEach((el) => {
    el.addEventListener('click', async () => {
      const act = el.dataset.act;
      try {
        if (act === 'seed') { await post('/api/demo/seed'); await refresh(); route(); }
        if (act === 'approve' || act === 'deny') {
          const res = await post(`/api/holds/${el.dataset.id}/${act === 'approve' ? 'approve' : 'deny'}`);
          $('#qmsg').innerHTML = banner(res.decision === 'block' ? 'block' : 'pass', act === 'approve' ? `Decision recorded: <b>${esc(res.decision || 'approved')}</b>.` : 'Denied — final. The proposal will never execute.');
          await refresh(); setTimeout(route, 900);
        }
        if (act === 'kill') { await post(`/api/mandates/${el.dataset.id}/revoke`); await refresh(); route(); }
        if (act === 'spend') {
          const agentId = el.dataset.id;
          const amount = Math.round(Number($(`#amt-${agentId}`).value) * 100);
          const merchant = $(`#mer-${agentId}`).value.replace(' (not allowed)', '');
          const res = await post(`/api/wallets/${agentId}/spend`, { proposal: { amountCents: amount, merchant } });
          const box = el.closest('.card').querySelector('.spend-result');
          box.innerHTML = banner(res.decision, `<b>${res.decision.toUpperCase()}</b>${res.reasons?.length ? ' — ' + esc(res.reasons.join('; ')) : ''}${res.balanceCents !== undefined ? ` · balance now ${money(res.balanceCents)}` : ''}${res.decision === 'hold' ? ' · see the Approval Queue' : ''}`);
          await refresh(); renderHealth();
        }
        if (act === 'job') {
          const agentId = el.dataset.id;
          await post('/api/jobs', { agentId, title: $(`#jobt-${agentId}`).value, amountCents: Math.round(Number($(`#joba-${agentId}`).value) * 100) });
          await refresh(); route();
        }
        if (act === 'deliver') {
          const res = await post(`/api/jobs/${el.dataset.id}/verify-delivery`);
          await refresh(); route();
          alert(`Released. Balance ${money(res.balanceCents)}${res.sweep ? ` · swept ${money(res.sweep.amountCents)} to the owner` : ' · no sweep (under cap)'}.`);
        }
        if (act === 'mkagent') {
          const a = await post('/api/agents', { ownerId: $('#g-owner').value || 'owner-1', name: $('#g-agent-name').value || 'Agent' });
          $('#g-who-result').innerHTML = banner('pass', `Agent registered: <b>${esc(a.name)}</b> <span class="mono">${a.id}</span>`);
          await refresh();
          const sel = $('#g-agent'); if (sel) { sel.innerHTML = state.overview.agents.map((x) => `<option value="${x.id}">${esc(x.name)} (owner ${esc(x.ownerId)})</option>`).join(''); sel.value = a.id; }
        }
        if (act === 'mkpass') {
          const p = await post('/api/passports', { ownerId: $('#g-owner').value || 'owner-1', tier: $('#g-tier').value });
          $('#g-who-result').innerHTML = banner('pass', `Passport issued: <b>${esc(p.tier)}</b> <span class="mono">${p.id}</span>`);
          await refresh();
          const sel = $('#g-pass'); if (sel) { sel.innerHTML = state.overview.passports.map((x) => `<option value="${x.id}">${esc(x.tier)} · ${short(x.id)} · owner ${esc(x.ownerId)}</option>`).join(''); sel.value = p.id; }
        }
        if (act === 'draft') {
          const d = await post('/api/guidelines/draft', { text: $('#g-text').value });
          $('#g-result').innerHTML = banner(d.missing.length ? 'hold' : 'pass',
            `Per-purchase <b>${d.draft.perPurchaseCapCents ? money(d.draft.perPurchaseCapCents) : '—'}</b> · Daily <b>${d.draft.dailyCapCents ? money(d.draft.dailyCapCents) : '—'}</b> · Threshold <b>${d.draft.everydayThresholdCents ? money(d.draft.everydayThresholdCents) : 'default'}</b> · Allowlist <b>${esc(d.draft.allowlist.join(', ') || '—')}</b> · Expires <b>${esc(d.draft.expiresAt?.slice(0, 10) || '—')}</b>${d.missing.length ? `<br>Missing (never invented): <b>${esc(d.missing.join(', '))}</b>` : ''}`);
        }
        if (act === 'sign') {
          const agentId = $('#g-agent').value; const passportId = $('#g-pass').value;
          const agent = state.overview.agents.find((a) => a.id === agentId);
          if (!agent || !passportId) { $('#g-result').innerHTML = banner('block', 'Pick an agent and a passport first (step 1).'); return; }
          const s = await post('/api/guidelines/sign', { text: $('#g-text').value, ownerId: agent.ownerId, agentId, passportId });
          $('#g-result').innerHTML = banner('pass', `Mandate signed: <span class="mono">${s.payload.id}</span><br>“${esc(s.guideline)}”`);
          await refresh(); renderHealth();
        }
        if (act === 'mkwallet') {
          const mandateId = $('#g-mandate').value;
          const m = state.overview.mandates.find((x) => x.payload.id === mandateId);
          if (!m) { $('#g-wallet-result').innerHTML = banner('block', 'Sign a mandate first.'); return; }
          const w = await post('/api/wallets', { agentId: m.payload.agentId, mandateId, operatingCapCents: Math.round(Number($('#g-cap').value) * 100), liveMode: true, openingBalanceCents: Math.round(Number($('#g-open').value) * 100) });
          $('#g-wallet-result').innerHTML = banner('pass', `Wallet live for ${esc(agentName(w.agentId))} — balance ${money(w.balanceCents)}. See Agent Wallets.`);
          await refresh(); renderHealth();
        }
        if (act === 'buy') {
          const item = CATALOG[Number(el.dataset.i)];
          const box = el.closest('.card').querySelector('.buy-result');
          try {
            const o = await post('/api/proof/order', { amount: item.price.toFixed(2), description: `ShipWorld — ${item.name}` });
            box.innerHTML = banner('pass', `Order created: <span class="mono">${esc(o.orderId)}</span> · status ${esc(o.status)}<br><a href="${esc(o.approveUrl)}" target="_blank" rel="noopener">Approve as the sandbox buyer →</a> then capture from the <a href="/proof.html">proof page</a>.`);
          } catch (err) {
            box.innerHTML = banner('info', `Live capture is not switched on for this server yet: ${esc(err.message)}<br>The split and points above are the configured design; set the Sandbox env and this button runs the real order.`);
          }
        }
        if (act === 'tpl') { sessionStorage.setItem('guidelinePrefill', el.dataset.t); location.hash = '#/guidelines'; route(); }
        if (act === 'j1') {
          const a = await post('/api/agents', { ownerId: 'judge-demo', name: 'Judge Demo Concierge' });
          const p = await post('/api/passports', { ownerId: 'judge-demo', tier: 'PREMIUM' });
          const s = await post('/api/guidelines/sign', { text: GUIDELINE_TEXT, ownerId: 'judge-demo', agentId: a.id, passportId: p.id });
          Object.assign(judge, { agentId: a.id, mandateId: s.payload.id });
          $('#j1-out').innerHTML = banner('pass', `Mandate <span class="mono">${s.payload.id}</span><br>“${esc(s.guideline)}”`);
          $('[data-act="j2"]').disabled = false;
        }
        if (act === 'j2') {
          await post('/api/wallets', { agentId: judge.agentId, mandateId: judge.mandateId, operatingCapCents: 18000, liveMode: true, openingBalanceCents: 20000 });
          let r = await post(`/api/wallets/${judge.agentId}/spend`, { proposal: { amountCents: 2500, merchant: 'Harbor Tours' } });
          let note = '';
          if (r.decision === 'hold') { const a = await post(`/api/holds/${r.holdId}/approve`); note = `First-payment hold (${esc(r.reasons.join('; '))}) — owner approved → `; r = a; }
          $('#j2-out').innerHTML = banner('pass', `${note}<b>${esc(r.decision.toUpperCase())}</b> · balance ${money(r.balanceCents ?? 17500)}`);
          $('[data-act="j3"]').disabled = false;
        }
        if (act === 'j3') {
          const r = await post(`/api/wallets/${judge.agentId}/spend`, { proposal: { amountCents: 4000, merchant: 'Harbor Tours' } });
          if (r.decision !== 'hold') { $('#j3-out').innerHTML = banner('block', `Expected a hold, got ${esc(r.decision)} — see the audit chain.`); return; }
          const d = await post(`/api/holds/${r.holdId}/deny`);
          $('#j3-out').innerHTML = banner('hold', `HELD — ${esc(r.reasons.join('; '))}<br>Owner decision: <b>${esc(d.status)}</b>. No money moved.`);
          $('[data-act="j4"]').disabled = false;
        }
        if (act === 'j4') {
          const job = await post('/api/jobs', { agentId: judge.agentId, title: 'Excursion season bookings', amountCents: 5000 });
          const rel = await post(`/api/jobs/${job.id}/verify-delivery`);
          const audit = await api('/api/audit');
          $('#j4-out').innerHTML = banner('pass', `Job released · balance ${money(rel.balanceCents)}${rel.sweep ? ` · <b>swept ${money(rel.sweep.amountCents)} to the owner</b>` : ''}<br>Audit chain: <b>${audit.verify.ok ? 'VERIFIED ✓' : 'BROKEN'}</b> · ${audit.verify.entries} entries · head <span class="mono">${short(audit.verify.headHash)}</span>`);
          await refresh(); renderHealth();
        }
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

window.addEventListener('hashchange', route);
(async () => { await refresh(); route(); })();
