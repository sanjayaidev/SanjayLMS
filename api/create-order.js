// /api/create-order.js
//
// Creates a payment order for a course purchase via Razorpay or PayPal.
// Adapted from sanjayaidev/donationalert's create-order.js, trimmed to the
// two gateways this app uses and rewired for course purchases instead of
// one-off tips.
//
// SECURITY: the course price is always looked up server-side from Supabase.
// The client only ever sends a course_id — never an amount — so a tampered
// request can't buy a course for less than its real price.

import crypto from 'crypto';

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY       = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ─── Supabase helpers (service role — bypasses RLS) ─────────────────────────
async function svc(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Prefer':        'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`Supabase ${method} ${path} -> ${res.status}: ${text}`);
  return data;
}

// Verify the caller's Supabase session token and return the user it belongs to.
async function getUser(token) {
  if (!token) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function getCourse(courseId) {
  const rows = await svc('GET', `/courses?id=eq.${courseId}&is_active=eq.true&select=id,title,price&limit=1`);
  return rows?.[0] || null;
}

async function alreadyOwns(userId, courseId) {
  const rows = await svc(
    'GET',
    `/user_courses?user_id=eq.${userId}&course_id=eq.${courseId}&payment_status=eq.completed&select=id&limit=1`
  );
  return !!rows?.[0];
}

// ─── Main handler ────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user  = await getUser(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated', code: 'AUTH_REQUIRED' });

  const { course_id, provider } = req.body || {};
  if (!course_id) return res.status(400).json({ error: 'Missing course_id' });
  if (!['razorpay', 'paypal'].includes(provider)) {
    return res.status(400).json({ error: 'provider must be "razorpay" or "paypal"' });
  }

  const course = await getCourse(course_id);
  if (!course) return res.status(404).json({ error: 'Course not found' });

  if (await alreadyOwns(user.id, course_id)) {
    return res.status(409).json({ error: 'You already own this course', code: 'ALREADY_OWNED' });
  }

  const amount = parseFloat(course.price);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({
      error: 'This course is free — use /api/enroll-free instead of /api/create-order',
      code:  'COURSE_IS_FREE',
    });
  }

  const orderId    = 'crs' + Date.now() + crypto.randomBytes(3).toString('hex');
  const origin     = req.headers.origin || `https://${req.headers.host}`;
  const isTestMode = process.env.PRODUCTION_MODE !== 'true';

  console.log(`[create-order] user=${user.id} course=${course_id} provider=${provider} mode=${isTestMode ? 'TEST' : 'PRODUCTION'}`);

  async function insertPendingOrder(extra = {}) {
    await svc('POST', '/payment_orders', {
      order_id: orderId,
      user_id:  user.id,
      course_id,
      provider,
      status:   'pending',
      amount,
      currency: provider === 'razorpay' ? 'INR' : 'USD',
      ...extra,
    });
  }

  if (provider === 'razorpay') {
    return handleRazorpay(res, { course, amount, orderId, user, insertPendingOrder, isTestMode });
  }
  return handlePaypal(res, { course, amount, orderId, course_id, origin, insertPendingOrder, isTestMode });
}

// ─── Razorpay ────────────────────────────────────────────────────────────────
async function handleRazorpay(res, { course, amount, orderId, user, insertPendingOrder, isTestMode }) {
  const keyId = isTestMode
    ? (process.env.RAZORPAY_TEST_KEY_ID     || process.env.RAZORPAY_KEY_ID)
    : process.env.RAZORPAY_KEY_ID;
  const keySecret = isTestMode
    ? (process.env.RAZORPAY_TEST_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET)
    : process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    return res.status(500).json({ error: 'Razorpay credentials not configured', code: 'MISSING_CREDENTIAL' });
  }

  try {
    const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64'),
      },
      body: JSON.stringify({
        amount:   Math.round(amount * 100), // paise
        currency: 'INR',
        receipt:  orderId,
        notes:    { course_id: course.id, user_id: user.id, course_title: course.title },
      }),
    });
    const order = await rzpRes.json();

    if (!rzpRes.ok) {
      console.error('[Razorpay] create-order error', order);
      return res.status(502).json({ error: 'Razorpay order creation failed', details: order });
    }

    await insertPendingOrder({ provider_order_id: order.id });

    return res.status(200).json({
      order_id:          orderId,
      razorpay_order_id: order.id,
      razorpay_key_id:   keyId,
      amount,
      currency: 'INR',
      provider: 'razorpay',
    });
  } catch (err) {
    console.error('[Razorpay] exception', err);
    return res.status(500).json({ error: err.message });
  }
}

// ─── PayPal ──────────────────────────────────────────────────────────────────
// Uses the v2 Orders API (create -> approve -> capture), not the deprecated
// v1 Payments API. Capture happens later in verify-order.js once the buyer
// has approved on PayPal's site.
async function handlePaypal(res, { course, amount, orderId, course_id, origin, insertPendingOrder, isTestMode }) {
  const clientId = isTestMode
    ? (process.env.PAYPAL_SANDBOX_CLIENT_ID     || process.env.PAYPAL_CLIENT_ID)
    : process.env.PAYPAL_CLIENT_ID;
  const clientSecret = isTestMode
    ? (process.env.PAYPAL_SANDBOX_CLIENT_SECRET || process.env.PAYPAL_CLIENT_SECRET)
    : process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'PayPal credentials not configured', code: 'MISSING_CREDENTIAL' });
  }

  const ppBase = isTestMode ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';

  try {
    const tokenRes = await fetch(`${ppBase}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      },
      body: 'grant_type=client_credentials',
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      return res.status(500).json({ error: 'PayPal token fetch failed' });
    }

    // NOTE: PayPal settles in USD here. If you need INR settlement, PayPal
    // requires a business account configured for that currency — swap
    // currency_code accordingly and convert `amount` yourself.
    const ppRes = await fetch(`${ppBase}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${tokenData.access_token}`,
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: orderId,
          custom_id:    orderId,
          description:  `Course: ${course.title}`.slice(0, 127),
          amount: { currency_code: 'USD', value: amount.toFixed(2) },
        }],
        application_context: {
          return_url:          `${origin}/checkout-status.html?order_id=${orderId}&provider=paypal&course_id=${course_id}`,
          cancel_url:          `${origin}/checkout.html?course=${course_id}`,
          user_action:         'PAY_NOW',
          shipping_preference: 'NO_SHIPPING',
        },
      }),
    });

    const order = await ppRes.json();
    const approvalUrl = order.links?.find(l => l.rel === 'approve')?.href;

    if (!ppRes.ok || !approvalUrl) {
      console.error('[PayPal] create-order error', order);
      return res.status(502).json({ error: 'PayPal order creation failed', details: order });
    }

    await insertPendingOrder({ provider_order_id: order.id });

    return res.status(200).json({
      order_id:            orderId,
      paypal_approval_url: approvalUrl,
      amount,
      currency: 'USD',
      provider: 'paypal',
    });
  } catch (err) {
    console.error('[PayPal] exception', err);
    return res.status(500).json({ error: err.message });
  }
}
