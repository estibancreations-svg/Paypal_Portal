// PayPortal — Phase 1 live proof (run: npm run prove)
// With Sandbox credentials in .env this script:
//   1) sends a $1.00 payout to PROOF_RECIPIENT_EMAIL and reads the batch back
//      until PayPal reports a terminal status;
//   2) creates a $10.00 order and prints its approval URL (a buyer must approve
//      it in a browser — PayPal requires the payer's own approval);
//   3) if given an approved order id (`npm run prove -- <ORDER_ID>`), captures
//      it and reads it back.
// Results are written to evidence/live-run-<timestamp>.json.
import { writeFileSync } from 'node:fs';
import { loadDotEnv, getConfig, isConfigured } from '../src/config.js';
import { PayPalClient, firstCapture, approveLink } from '../src/paypal.js';

loadDotEnv();
const cfg = getConfig();
if (!isConfigured(cfg)) {
  console.error('Not configured: add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (Sandbox app) to .env first.');
  process.exit(2);
}
const pp = new PayPalClient(cfg);
const evidence = { at: new Date().toISOString(), baseUrl: cfg.baseUrl, steps: [] };
const record = (step, data) => { evidence.steps.push({ step, ...data }); console.log(step, JSON.stringify(data)); };

const captureOrderId = process.argv[2];
if (captureOrderId) {
  await pp.captureOrder(captureOrderId);
  const readBack = await pp.getOrder(captureOrderId);
  record('capture+readback', { orderId: readBack.id, orderStatus: readBack.status, capture: firstCapture(readBack) });
} else {
  const recipient = process.env.PROOF_RECIPIENT_EMAIL;
  if (!recipient) {
    console.error('Set PROOF_RECIPIENT_EMAIL (a Sandbox account email) in .env for the payout proof.');
    process.exit(2);
  }
  const payout = await pp.createPayout({ email: recipient, amount: '1.00', note: 'PayPortal Phase 1 proof payout' });
  const batchId = payout.batch_header.payout_batch_id;
  let batch = await pp.getPayoutBatch(batchId);
  for (let i = 0; i < 10 && batch.batch_header.batch_status === 'PENDING'; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    batch = await pp.getPayoutBatch(batchId);
  }
  record('payout+readback', { payoutBatchId: batchId, batchStatus: batch.batch_header.batch_status });

  const order = await pp.createOrder({ amount: '10.00', description: 'PayPortal Phase 1 proof order' });
  record('order-created', { orderId: order.id, status: order.status, approveUrl: approveLink(order) });
  console.log('\nNext: approve the order as the sandbox buyer at the URL above, then run:');
  console.log(`  npm run prove -- ${order.id}`);
}

const file = `evidence/live-run-${Date.now()}.json`;
writeFileSync(file, JSON.stringify(evidence, null, 2));
console.log(`\nEvidence written to ${file}`);
