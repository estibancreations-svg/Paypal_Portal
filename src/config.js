// PayPortal — minimal environment config (no dependencies).
// Loads a local .env file if present; real values always win from the process env.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadDotEnv(path = join(root, '.env')) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

export function getConfig(env = process.env) {
  return {
    clientId: env.PAYPAL_CLIENT_ID || '',
    clientSecret: env.PAYPAL_CLIENT_SECRET || '',
    baseUrl: (env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com').replace(/\/$/, ''),
    webhookId: env.PAYPAL_WEBHOOK_ID || '',
    mandateSecret: env.MANDATE_SIGNING_SECRET || '',
    port: Number(env.PORT || 8080),
  };
}

export function isConfigured(cfg) {
  return Boolean(cfg.clientId && cfg.clientSecret);
}
