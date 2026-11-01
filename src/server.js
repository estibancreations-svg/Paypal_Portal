// PayPortal — Phase 1 bare proof server (zero dependencies, Node http).
// Purpose: prove the PayPal rails end to end — Orders create/approve/capture,
// one Payouts batch, webhook signature verification, and read-backs — before
// any product surface is built on top.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv, getConfig, isConfigured } from './config.js';
import { PayPalClient, firstCapture, approveLink } from './paypal.js';
import { MandateRegistry } from './mandates.js';
import { AuditChain } from './audit.js';
import { IdentityRegistry } from './identity.js';
import { WalletEngine } from './wallets.js';
import { RiskService } from './risk.js';
import { parseGuideline, draftToMandateFields, renderGuideline } from './guidelines.js';

loadDotEnv();
const cfg = getConfig();
const audit = new AuditChain();
const identity = new IdentityRegistry();
const mandates = cfg.mandateSecret ? new MandateRegistry(cfg.mandateSecret) : null;
function mandateRegistry() {
  if (!mandates) {
    const err = new Error('MANDATE_SIGNING_SECRET is not configured in the server .env.');
    err.statusCode = 503;
    throw err;
  }
  return mandates;
}
const wallets = mandates ? new WalletEngine({ mandates, audit, risk: new RiskService() }) : null;
function walletEngine() {
  if (!wallets) {
    const err = new Error('Wallets require MANDATE_SIGNING_SECRET in the server .env.');
    err.statusCode = 503;
    throw err;
  }
  return wallets;
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = readFileSync(join(root, 'public', 'index.html'), 'utf8');

let client = null;
function paypal() {
  if (!isConfigured(cfg)) {
    const err = new Error('PayPal Sandbox credentials are not configured. Copy .env.example to .env and add the Sandbox app Client ID and Secret.');
    err.statusCode = 503;
    throw err;
  }
  if (!client) client = new PayPalClient(cfg);
  return client;
}

function send(res, status, body, type = 'application/json') {
  const data = type === 'application/json' ? JSON.stringify(body) : body;
  res.writeHead(status, { 'Content-Type': type });
  res.end(data);
}

async function jsonBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${cfg.port}`);
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, indexHtml, 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, { ok: true, configured: isConfigured(cfg), baseUrl: cfg.baseUrl });
    }
    if (req.method === 'GET' && (url.pathname === '/return' || url.pathname === '/cancel')) {
      const orderId = url.searchParams.get('token') || '';
      return send(res, 200,
        `<!doctype html><meta charset="utf-8"><title>PayPortal proof</title>` +
        `<p>${url.pathname === '/return' ? 'Approved.' : 'Cancelled.'} Order: <b>${orderId}</b></p>` +
        `<p>Return to the <a href="/">proof page</a> and press "Capture + read back".</p>`,
        'text/html; charset=utf-8');
    }

    // Create an order (Phase 1 proof step 1)
    if (req.method === 'POST' && url.pathname === '/api/proof/order') {
      const { amount = '10.00', description = 'PayPortal Phase 1 proof order' } = await jsonBody(req);
      const order = await paypal().createOrder({
        amount,
        description,
        returnUrl: `http://localhost:${cfg.port}/return`,
        cancelUrl: `http://localhost:${cfg.port}/cancel`,
      });
      return send(res, 201, { orderId: order.id, status: order.status, approveUrl: approveLink(order) });
    }

    // Capture an approved order, then READ BACK from PayPal (proof step 2)
    const captureMatch = url.pathname.match(/^\/api\/proof\/order\/([A-Z0-9]+)\/capture$/);
    if (req.method === 'POST' && captureMatch) {
      const pp = paypal();
      const captured = await pp.captureOrder(captureMatch[1]);
      const readBack = await pp.getOrder(captureMatch[1]);
      return send(res, 200, {
        orderId: readBack.id,
        orderStatus: readBack.status,
        capture: firstCapture(readBack),
        captureResponseStatus: captured.status,
      });
    }

    // Read back an order at any time
    const orderMatch = url.pathname.match(/^\/api\/proof\/order\/([A-Z0-9]+)$/);
    if (req.method === 'GET' && orderMatch) {
      const readBack = await paypal().getOrder(orderMatch[1]);
      return send(res, 200, { orderId: readBack.id, status: readBack.status, capture: firstCapture(readBack) });
    }

    // Send one payout, then READ BACK the batch (proof step 3)
    if (req.method === 'POST' && url.pathname === '/api/proof/payout') {
      const { email, amount = '1.00' } = await jsonBody(req);
      if (!email) return send(res, 400, { error: 'email (sandbox recipient) is required' });
      const pp = paypal();
      const payout = await pp.createPayout({ email, amount, note: 'PayPortal Phase 1 proof payout' });
      const batchId = payout.batch_header.payout_batch_id;
      const readBack = await pp.getPayoutBatch(batchId);
      return send(res, 201, {
        payoutBatchId: batchId,
        batchStatus: readBack.batch_header.batch_status,
        senderBatchId: readBack.batch_header.sender_batch_header.sender_batch_id,
      });
    }

    // ---- Phase 2: identity, mandates, audit ----
    if (req.method === 'POST' && url.pathname === '/api/agents') {
      const agent = identity.registerAgent(await jsonBody(req));
      audit.append({ type: 'agent.registered', agentId: agent.id, ownerId: agent.ownerId });
      return send(res, 201, agent);
    }
    if (req.method === 'POST' && url.pathname === '/api/passports') {
      const passport = identity.issuePassport(await jsonBody(req));
      audit.append({ type: 'passport.issued', passportId: passport.id, ownerId: passport.ownerId, tier: passport.tier });
      return send(res, 201, passport);
    }
    if (req.method === 'POST' && url.pathname === '/api/mandates') {
      const signed = mandateRegistry().issue(await jsonBody(req));
      audit.append({ type: 'mandate.issued', mandateId: signed.payload.id, ownerId: signed.payload.ownerId, agentId: signed.payload.agentId });
      return send(res, 201, signed);
    }
    const mandateMatch = url.pathname.match(/^\/api\/mandates\/([0-9a-f-]{36})$/);
    if (req.method === 'GET' && mandateMatch) {
      const registry = mandateRegistry();
      const record = registry.get(mandateMatch[1]);
      if (!record) return send(res, 404, { error: 'mandate not found' });
      return send(res, 200, { ...record, validation: registry.validate(mandateMatch[1]) });
    }
    const revokeMatch = url.pathname.match(/^\/api\/mandates\/([0-9a-f-]{36})\/revoke$/);
    if (req.method === 'POST' && revokeMatch) {
      const ok = mandateRegistry().revoke(revokeMatch[1]);
      if (!ok) return send(res, 404, { error: 'mandate not found' });
      audit.append({ type: 'mandate.revoked', mandateId: revokeMatch[1] });
      return send(res, 200, { revoked: true, mandateId: revokeMatch[1] });
    }
    const authorizeMatch = url.pathname.match(/^\/api\/mandates\/([0-9a-f-]{36})\/authorize$/);
    if (req.method === 'POST' && authorizeMatch) {
      const { proposal, spentTodayCents = 0 } = await jsonBody(req);
      const result = mandateRegistry().authorize(authorizeMatch[1], proposal, { spentTodayCents });
      audit.append({ type: result.decision === 'pass' ? 'payment.authorized' : 'payment.blocked', mandateId: authorizeMatch[1], amountCents: proposal?.amountCents, reasons: result.reasons });
      return send(res, 200, result);
    }
    if (req.method === 'GET' && url.pathname === '/api/audit') {
      return send(res, 200, { verify: audit.verify(), entries: audit.entries });
    }

    // ---- Phase 3: agent wallets, jobs, earnings ----
    if (req.method === 'POST' && url.pathname === '/api/wallets') {
      const wallet = walletEngine().createWallet(await jsonBody(req));
      return send(res, 201, wallet);
    }
    const walletMatch = url.pathname.match(/^\/api\/wallets\/([0-9a-f-]{36})$/);
    if (req.method === 'GET' && walletMatch) {
      const engine = walletEngine();
      const wallet = engine.getWallet(walletMatch[1]);
      if (!wallet) return send(res, 404, { error: 'wallet not found' });
      return send(res, 200, { wallet, pnl: engine.pnl(walletMatch[1]) });
    }
    const spendMatch = url.pathname.match(/^\/api\/wallets\/([0-9a-f-]{36})\/spend$/);
    if (req.method === 'POST' && spendMatch) {
      const { proposal } = await jsonBody(req);
      const result = walletEngine().spend(spendMatch[1], proposal);
      return send(res, 200, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/jobs') {
      const job = walletEngine().createJob(await jsonBody(req));
      return send(res, 201, job);
    }
    const deliverMatch = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})\/verify-delivery$/);
    if (req.method === 'POST' && deliverMatch) {
      const result = walletEngine().verifyDelivery(deliverMatch[1]);
      return send(res, 200, { job: result.job, balanceCents: result.balanceCents, sweep: result.sweep });
    }

    // ---- Phase 4: guidelines generator + approval queue ----
    if (req.method === 'POST' && url.pathname === '/api/guidelines/draft') {
      const { text } = await jsonBody(req);
      return send(res, 200, parseGuideline(text || ''));
    }
    if (req.method === 'POST' && url.pathname === '/api/guidelines/sign') {
      const { text, draft, ownerId, agentId, passportId } = await jsonBody(req);
      const parsed = draft || parseGuideline(text || '').draft;
      const fields = draftToMandateFields(parsed, { ownerId, agentId, passportId });
      const signed = mandateRegistry().issue(fields);
      audit.append({ type: 'mandate.issued', mandateId: signed.payload.id, ownerId, agentId, via: 'guideline' });
      return send(res, 201, { ...signed, guideline: renderGuideline(signed.payload) });
    }
    if (req.method === 'GET' && url.pathname === '/api/holds') {
      return send(res, 200, { pending: walletEngine().pendingHolds() });
    }
    const approveHoldMatch = url.pathname.match(/^\/api\/holds\/([0-9a-f-]{36})\/approve$/);
    if (req.method === 'POST' && approveHoldMatch) {
      const result = walletEngine().approveHold(approveHoldMatch[1]);
      return send(res, 200, result);
    }
    const denyHoldMatch = url.pathname.match(/^\/api\/holds\/([0-9a-f-]{36})\/deny$/);
    if (req.method === 'POST' && denyHoldMatch) {
      const hold = walletEngine().denyHold(denyHoldMatch[1]);
      return send(res, 200, hold);
    }

    // Webhook receiver: verify the signature with PayPal before trusting it
    if (req.method === 'POST' && url.pathname === '/api/webhooks') {
      const event = await jsonBody(req);
      let verification = 'skipped-no-webhook-id';
      if (cfg.webhookId) {
        const result = await paypal().verifyWebhookSignature({ headers: req.headers, webhookEvent: event, webhookId: cfg.webhookId });
        verification = result.verification_status;
      }
      console.log(`[webhook] ${event.event_type || 'unknown'} id=${event.id || '?'} verification=${verification}`);
      return send(res, 200, { received: true, verification });
    }

    return send(res, 404, { error: 'not found' });
  } catch (err) {
    const status = err.statusCode || err.status || 500;
    console.error('[error]', err.message);
    return send(res, status, { error: err.message, details: err.body || undefined });
  }
});

server.listen(cfg.port, () => {
  console.log(`PayPortal Phase 1 proof server on http://localhost:${cfg.port} (configured: ${isConfigured(cfg)})`);
});
