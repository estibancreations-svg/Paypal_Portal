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

loadDotEnv();
const cfg = getConfig();
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
