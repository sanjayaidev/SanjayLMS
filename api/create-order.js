// /api/create-order.js
//
// Creates a payment order for a course purchase via Razorpay, PayPal, or
// Cashfree. Adapted from sanjayaidev/donationalert's create-order.js, trimmed
// to the gateways this app uses and rewired for course purchases instead of
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
  const rows = await svc('GET', `/courses?id=eq.${courseId}&is_active=eq.true&select=id,title,price,price_usd&limit=1`);
  return rows?.[0] || null;
}

async function alreadyOwns(userId, courseId) {
  const rows = await svc(
    'GET',
    `/user_courses?user_id=eq.${userId}&course_id=eq.${courseId}&payment_status=eq.completed&select=id&limit=1`
  );
  return !!rows?.[0];
}

// ─── Module-cart helpers (a-la-carte purchases) ─────────────────────────────
// The client sends module_ids only. We look every one up server-side —
// including price, is_purchasable_standalone, and is_active — so a tampered
// request can never buy a module for less than its real price, or buy one
// that isn't for sale on its own.
async function getPurchasableModules(courseId, moduleIds) {
  const idList = moduleIds.map(id => `"${id}"`).join(',');
  const rows = await svc(
    'GET',
    `/course_modules?id=in.(${idList})&course_id=eq.${courseId}&is_active=eq.true&is_purchasable_standalone=eq.true` +
    `&select=id,title,price,price_usd`
  );
  return rows || [];
}

async function alreadyOwnsModules(userId, moduleIds) {
  const idList = moduleIds.map(id => `"${id}"`).join(',');
  const rows = await svc(
    'GET',
    `/user_course_modules?user_id=eq.${userId}&module_id=in.(${idList})&payment_status=eq.completed&select=module_id`
  );
  return new Set((rows || []).map(r => r.module_id));
}

// ─── Main handler ────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Fail fast with a clear message if the base Supabase env vars aren't set
  // on this deployment, instead of letting it blow up as a cryptic
  // "401 No API key found in request" three calls deep inside svc().
  const missingBase = [];
  if (!SUPABASE_URL)      missingBase.push('SUPABASE_URL');
  if (!SUPABASE_ANON_KEY) missingBase.push('SUPABASE_ANON_KEY');
  if (!SERVICE_KEY)       missingBase.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missingBase.length) {
    console.error('[create-order] missing required env vars:', missingBase.join(', '));
    return res.status(500).json({
      error: `Server misconfigured — missing env var(s): ${missingBase.join(', ')}. Set these in Vercel Project Settings → Environment Variables and redeploy.`,
      code:  'MISSING_ENV',
    });
  }

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user  = await getUser(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated', code: 'AUTH_REQUIRED' });

  const { course_id, module_ids, provider } = req.body || {};
  if (!course_id) return res.status(400).json({ error: 'Missing course_id' });
  if (!['razorpay', 'paypal', 'cashfree'].includes(provider)) {
    return res.status(400).json({ error: 'provider must be "razorpay", "paypal", or "cashfree"' });
  }

  const course = await getCourse(course_id);
  if (!course) return res.status(404).json({ error: 'Course not found' });

  // Cart of individual modules ("pick modules" flow) vs. the whole course
  // ("full package" flow). module_ids is only present/non-empty for the former.
  const isModuleCart = Array.isArray(module_ids) && module_ids.length > 0;

  let itemType, amountInr, amountUsd, cartModules;

  if (isModuleCart) {
    if (await alreadyOwns(user.id, course_id)) {
      return res.status(409).json({ error: 'You already own the full course', code: 'ALREADY_OWNED' });
    }

    cartModules = await getPurchasableModules(course_id, module_ids);
    if (cartModules.length === 0) {
      return res.status(400).json({ error: 'None of the requested modules are available for standalone purchase' });
    }

    const owned = await alreadyOwnsModules(user.id, cartModules.map(m => m.id));
    cartModules = cartModules.filter(m => !owned.has(m.id));
    if (cartModules.length === 0) {
      return res.status(409).json({ error: 'You already own every module in this order', code: 'ALREADY_OWNED' });
    }

    itemType   = 'modules';
    amountInr  = cartModules.reduce((sum, m) => sum + parseFloat(m.price || 0), 0);
    amountUsd  = cartModules.every(m => Number.isFinite(parseFloat(m.price_usd)))
      ? cartModules.reduce((sum, m) => sum + parseFloat(m.price_usd), 0)
      : NaN; // PayPal unavailable if any selected module lacks a USD price
  } else {
    if (await alreadyOwns(user.id, course_id)) {
      return res.status(409).json({ error: 'You already own this course', code: 'ALREADY_OWNED' });
    }
    itemType  = 'full_course';
    amountInr = parseFloat(course.price);
    amountUsd = parseFloat(course.price_usd);
  }

  if (provider === 'paypal' && (!Number.isFinite(amountUsd) || amountUsd <= 0)) {
    return res.status(400).json({
      error: isModuleCart
        ? 'One or more selected modules do not have a USD price set — PayPal is unavailable for this order. Use Razorpay instead.'
        : 'This course does not have a USD price set — PayPal is unavailable for it. Use Razorpay instead.',
      code:  'NO_USD_PRICE',
    });
  }
  if ((provider === 'razorpay' || provider === 'cashfree') && (!Number.isFinite(amountInr) || amountInr <= 0)) {
    return res.status(400).json({
      error: isModuleCart
        ? 'This order totals ₹0 — use /api/enroll-free instead of /api/create-order'
        : 'This course is free — use /api/enroll-free instead of /api/create-order',
      code:  'COURSE_IS_FREE',
    });
  }

  // The amount actually charged depends on which gateway was picked:
  // Razorpay and Cashfree always settle in INR, PayPal always settles in USD here.
  const amount = provider === 'paypal' ? amountUsd : amountInr;

  const orderId    = 'crs' + Date.now() + crypto.randomBytes(3).toString('hex');
  const origin     = req.headers.origin || `https://${req.headers.host}`;
  const isTestMode = process.env.PRODUCTION_MODE !== 'true';

  // Human-readable description for provider dashboards / receipts.
  const description = isModuleCart
    ? `${course.title}: ${cartModules.map(m => m.title).join(', ')}`
    : `${course.title} (full package)`;

  console.log(`[create-order] user=${user.id} course=${course_id} item_type=${itemType} provider=${provider} mode=${isTestMode ? 'TEST' : 'PRODUCTION'}`);

  async function insertPendingOrder(extra = {}) {
    await svc('POST', '/payment_orders', {
      order_id: orderId,
      user_id:  user.id,
      course_id,
      provider,
      status:   'pending',
      amount,
      currency: provider === 'paypal' ? 'USD' : 'INR',
      item_type:  itemType,
      module_ids: isModuleCart ? cartModules.map(m => m.id) : null,
      ...extra,
    });
  }

  if (provider === 'razorpay') {
    return handleRazorpay(res, { course, description, amount, orderId, user, insertPendingOrder, isTestMode });
  }
  if (provider === 'cashfree') {
    return handleCashfree(res, { course, description, amount, orderId, user, origin, insertPendingOrder, isTestMode });
  }
  return handlePaypal(res, { course, description, amount, orderId, course_id, origin, insertPendingOrder, isTestMode });
}

// ─── Razorpay ────────────────────────────────────────────────────────────────
async function handleRazorpay(res, { course, description, amount, orderId, user, insertPendingOrder, isTestMode }) {
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
        notes:    { course_id: course.id, user_id: user.id, description },
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

// ─── Cashfree ────────────────────────────────────────────────────────────────
// Uses the Cashfree PG Orders API (2023-08-01). create-order here returns a
// payment_session_id, which the client feeds to the Cashfree JS SDK
// (cashfree.checkout()) to render drop-in checkout. Actual payment
// confirmation is polled independently in verify-order.js — the
// payment_session_id alone never grants access.
async function handleCashfree(res, { course, description, amount, orderId, user, origin, insertPendingOrder, isTestMode }) {
  const appId = isTestMode
    ? (process.env.CASHFREE_TEST_APP_ID     || process.env.CASHFREE_APP_ID)
    : process.env.CASHFREE_APP_ID;
  const secretKey = isTestMode
    ? (process.env.CASHFREE_TEST_SECRET_KEY || process.env.CASHFREE_SECRET_KEY)
    : process.env.CASHFREE_SECRET_KEY;

  if (!appId || !secretKey) {
    return res.status(500).json({ error: 'Cashfree credentials not configured', code: 'MISSING_CREDENTIAL' });
  }

  const cfBase = isTestMode ? 'https://sandbox.cashfree.com/pg' : 'https://api.cashfree.com/pg';

  try {
    const cfRes = await fetch(`${cfBase}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'x-client-id':     appId,
        'x-client-secret': secretKey,
        'x-api-version':   '2023-08-01',
      },
      body: JSON.stringify({
        order_id:       orderId,
        order_amount:   amount,
        order_currency: 'INR',
        customer_details: {
          customer_id:    user.id,
          customer_email: user.email,
          // Cashfree requires a phone number on the order. Profiles in this
          // app don't collect one, so fall back to a placeholder — swap in
          // a real collected number here if you add a phone field later.
          customer_phone: user.phone || '9999999999',
        },
        order_meta: {
          return_url: `${origin}/checkout-status.html?order_id=${orderId}&provider=cashfree&course_id=${course.id}`,
        },
        order_note: description.slice(0, 255),
      }),
    });
    const order = await cfRes.json();

    if (!cfRes.ok || !order.payment_session_id) {
      console.error('[Cashfree] create-order error', order);
      return res.status(502).json({ error: 'Cashfree order creation failed', details: order });
    }

    await insertPendingOrder({ provider_order_id: order.order_id || orderId });

    return res.status(200).json({
      order_id:                 orderId,
      cashfree_payment_session: order.payment_session_id,
      cashfree_mode:             isTestMode ? 'sandbox' : 'production',
      amount,
      currency: 'INR',
      provider: 'cashfree',
    });
  } catch (err) {
    console.error('[Cashfree] exception', err);
    return res.status(500).json({ error: err.message });
  }
}

// ─── PayPal ──────────────────────────────────────────────────────────────────
// Uses the v2 Orders API (create -> approve -> capture), not the deprecated
// v1 Payments API. Capture happens later in verify-order.js once the buyer
// has approved on PayPal's site.
async function handlePaypal(res, { course, description, amount, orderId, course_id, origin, insertPendingOrder, isTestMode }) {
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

    // Settles in USD (course.price_usd), independent of the INR price used
    // for Razorpay. Set courses.price_usd if you want PayPal enabled for a course.
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
          description:  description.slice(0, 127),
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
