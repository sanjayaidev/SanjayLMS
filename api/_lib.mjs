// Shared helpers for the prebooking API. Zero dependencies (Node 18+ fetch + crypto).
// Files starting with "_" inside /api are not exposed as routes on Vercel.
import crypto from 'node:crypto';

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // server only. Never put this in HTML.

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  'https://sanjaymeher.online,https://www.sanjaymeher.online')
  .split(',').map((s) => s.trim()).filter(Boolean);

/** Sets CORS headers. Returns true if the request was a preflight and is already answered. */
export function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

/** Minimal PostgREST client using the service-role key. */
export async function sb(path, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

/** Creates a Razorpay order. */
export async function razorpayOrder(payload) {
  const auth = Buffer.from(
    `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
  ).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.description || 'Razorpay order failed');
  return data;
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Checkout success signature: HMAC_SHA256(order_id|payment_id, key_secret). */
export function verifyCheckoutSignature(orderId, paymentId, signature) {
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return safeEqual(expected, signature || '');
}

/** pending -> paid. Idempotent: returns [] if it was already paid (verify + webhook can both call it). */
export async function markPaid(orderId, paymentId) {
  return sb(
    `prebookings?razorpay_order_id=eq.${encodeURIComponent(orderId)}&status=eq.pending`,
    {
      method: 'PATCH',
      body: { status: 'paid', razorpay_payment_id: paymentId, paid_at: new Date().toISOString() },
      prefer: 'return=representation',
    }
  );
}

export function readJson(req) {
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  return req.body || {};
}
