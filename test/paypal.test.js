// Phase 1 tests — PayPal client behaviour against a stubbed PayPal API.
// These prove request shapes and read-back handling. The live sandbox proof
// (real IDs) is scripts/prove-live.js and lands in evidence/ once credentials exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PayPalClient, firstCapture, approveLink } from '../src/paypal.js';

function stubFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected call: ${url}`);
    return {
      ok: next.status < 400,
      status: next.status,
      json: async () => next.body,
    };
  };
  return { fetchImpl, calls };
}

const token = { status: 200, body: { access_token: 'tok-1', expires_in: 3600 } };
const client = (fetchImpl) => new PayPalClient({ clientId: 'cid', clientSecret: 'sec', baseUrl: 'https://api-m.sandbox.paypal.com', fetchImpl });

test('access token uses client credentials grant with Basic auth', async () => {
  const { fetchImpl, calls } = stubFetch([token]);
  const c = client(fetchImpl);
  assert.equal(await c.accessToken(), 'tok-1');
  assert.equal(calls[0].url, 'https://api-m.sandbox.paypal.com/v1/oauth2/token');
  assert.match(calls[0].opts.headers.Authorization, /^Basic /);
  assert.equal(calls[0].opts.body, 'grant_type=client_credentials');
});

test('createOrder sends CAPTURE intent and purchase unit amount', async () => {
  const { fetchImpl, calls } = stubFetch([token, { status: 201, body: { id: 'ORD1', status: 'CREATED', links: [{ rel: 'payer-action', href: 'https://approve' }] } }]);
  const c = client(fetchImpl);
  const order = await c.createOrder({ amount: '10.00' });
  const sent = JSON.parse(calls[1].opts.body);
  assert.equal(sent.intent, 'CAPTURE');
  assert.equal(sent.purchase_units[0].amount.value, '10.00');
  assert.equal(sent.purchase_units[0].amount.currency_code, 'USD');
  assert.equal(approveLink(order), 'https://approve');
});

test('capture read-back: firstCapture extracts id, status, amount', () => {
  const order = { purchase_units: [{ payments: { captures: [{ id: 'CAP1', status: 'COMPLETED', amount: { value: '10.00', currency_code: 'USD' } }] } }] };
  assert.deepEqual(firstCapture(order), { captureId: 'CAP1', status: 'COMPLETED', amount: '10.00', currency: 'USD' });
  assert.equal(firstCapture({ purchase_units: [{}] }), null);
});

test('createPayout builds one EMAIL item and an idempotent batch id', async () => {
  const { fetchImpl, calls } = stubFetch([token, { status: 201, body: { batch_header: { payout_batch_id: 'B1' } } }]);
  const c = client(fetchImpl);
  await c.createPayout({ email: 'sb-buyer@example.com', amount: '1.00', senderBatchId: 'batch-fixed-1' });
  const sent = JSON.parse(calls[1].opts.body);
  assert.equal(sent.sender_batch_header.sender_batch_id, 'batch-fixed-1');
  assert.equal(sent.items[0].receiver, 'sb-buyer@example.com');
  assert.equal(sent.items[0].amount.value, '1.00');
  assert.equal(calls[1].opts.headers['PayPal-Request-Id'], 'batch-fixed-1');
});

test('webhook verification posts the transmission fields PayPal requires', async () => {
  const { fetchImpl, calls } = stubFetch([token, { status: 200, body: { verification_status: 'SUCCESS' } }]);
  const c = client(fetchImpl);
  const headers = {
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-cert-url': 'https://cert',
    'paypal-transmission-id': 't1',
    'paypal-transmission-sig': 'sig',
    'paypal-transmission-time': '2026-10-29T00:00:00Z',
  };
  const result = await c.verifyWebhookSignature({ headers, webhookEvent: { id: 'EV1' }, webhookId: 'WH1' });
  const sent = JSON.parse(calls[1].opts.body);
  assert.equal(sent.webhook_id, 'WH1');
  assert.equal(sent.transmission_id, 't1');
  assert.equal(result.verification_status, 'SUCCESS');
});

test('API errors surface as PayPalError with status and body', async () => {
  const { fetchImpl } = stubFetch([token, { status: 422, body: { name: 'UNPROCESSABLE_ENTITY', message: 'bad' } }]);
  const c = client(fetchImpl);
  await assert.rejects(() => c.createOrder({ amount: 'x' }), (err) => err.status === 422 && err.body.name === 'UNPROCESSABLE_ENTITY');
});
