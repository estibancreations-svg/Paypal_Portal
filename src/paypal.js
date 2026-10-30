// PayPortal — PayPal REST client (Sandbox-first, zero dependencies).
// Money rules baked in:
//  - The client never marks anything "done" itself; callers read state back
//    from PayPal (getOrder / getCapture / getPayoutBatch) before recording it.
//  - Every mutating call can carry a PayPal-Request-Id for idempotency.

export class PayPalError extends Error {
  constructor(status, body) {
    super(`PayPal API ${status}: ${body?.name || 'error'} ${body?.message || ''}`.trim());
    this.status = status;
    this.body = body;
  }
}

export class PayPalClient {
  constructor({ clientId, clientSecret, baseUrl, fetchImpl = fetch }) {
    if (!clientId || !clientSecret) throw new Error('PayPal client requires clientId and clientSecret');
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetch = fetchImpl;
    this._token = null;
    this._tokenExpiresAt = 0;
  }

  async accessToken() {
    const now = Date.now();
    if (this._token && now < this._tokenExpiresAt - 30_000) return this._token;
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await this.fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new PayPalError(res.status, body);
    this._token = body.access_token;
    this._tokenExpiresAt = now + (body.expires_in || 300) * 1000;
    return this._token;
  }

  async request(method, path, body, { requestId } = {}) {
    const token = await this.accessToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    if (requestId) headers['PayPal-Request-Id'] = requestId;
    const res = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
    if (!res.ok) throw new PayPalError(res.status, data);
    return data;
  }

  // ---- Orders ----
  createOrder({ amount, currency = 'USD', description = 'PayPortal order', intent = 'CAPTURE', returnUrl, cancelUrl, requestId }) {
    const unit = {
      description,
      amount: { currency_code: currency, value: String(amount) },
    };
    const payload = { intent, purchase_units: [unit] };
    if (returnUrl || cancelUrl) {
      payload.payment_source = {
        paypal: {
          experience_context: {
            return_url: returnUrl,
            cancel_url: cancelUrl,
            user_action: 'PAY_NOW',
          },
        },
      };
    }
    return this.request('POST', '/v2/checkout/orders', payload, { requestId });
  }

  captureOrder(orderId, { requestId } = {}) {
    return this.request('POST', `/v2/checkout/orders/${orderId}/capture`, {}, { requestId });
  }

  authorizeOrder(orderId, { requestId } = {}) {
    return this.request('POST', `/v2/checkout/orders/${orderId}/authorize`, {}, { requestId });
  }

  getOrder(orderId) {
    return this.request('GET', `/v2/checkout/orders/${orderId}`);
  }

  getCapture(captureId) {
    return this.request('GET', `/v2/payments/captures/${captureId}`);
  }

  // ---- Payouts ----
  createPayout({ email, amount, currency = 'USD', note = 'PayPortal payout', senderBatchId }) {
    const batchId = senderBatchId || `pp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return this.request('POST', '/v1/payments/payouts', {
      sender_batch_header: {
        sender_batch_id: batchId,
        email_subject: 'You have a payment from PayPortal',
        email_message: note,
      },
      items: [
        {
          recipient_type: 'EMAIL',
          receiver: email,
          amount: { currency, value: String(amount) },
          note,
          sender_item_id: `${batchId}-1`,
        },
      ],
    }, { requestId: batchId });
  }

  getPayoutBatch(batchId) {
    return this.request('GET', `/v1/payments/payouts/${batchId}`);
  }

  getPayoutItem(itemId) {
    return this.request('GET', `/v1/payments/payouts-item/${itemId}`);
  }

  // ---- Webhooks ----
  verifyWebhookSignature({ headers, webhookEvent, webhookId }) {
    return this.request('POST', '/v1/notifications/verify-webhook-signature', {
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: webhookId,
      webhook_event: webhookEvent,
    });
  }
}

// Extract the first capture's facts from an order read-back (post-capture shape).
export function firstCapture(order) {
  const unit = order?.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  if (!capture) return null;
  return {
    captureId: capture.id,
    status: capture.status,
    amount: capture.amount?.value,
    currency: capture.amount?.currency_code,
  };
}

export function approveLink(order) {
  return order?.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href || null;
}
