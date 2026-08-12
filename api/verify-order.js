// /api/verify-order.js
//
// Polled by checkout-status.html every 3s. Independently re-checks payment
// status with Razorpay/PayPal (never trusts params echoed back in the
// redirect URL), and on confirmed payment is the ONLY place that grants
// course access by writing to user_courses.
//
// Adapted from sanjayaidev/donationalert's verify-order.js, trimmed to
// Razorpay + PayPal and rewired to grant course access instead of firing
// a StreamElements alert.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const isTestMode   = process.env.PRODUCTION_MODE !== 'true';

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

async function getOrder(orderId) {
  const rows = await svc('GET', `/payment_orders?order_id=eq.${encodeURIComponent(orderId)}&select=*&limit=1`);
  return rows?.[0] || null;
}

async function updateOrder(orderId, fields) {
  await svc('PATCH', `/payment_orders?order_id=eq.${encodeURIComponent(orderId)}`, fields);
}

async function grantCourseAccess(order, providerOrderId) {
  // Idempotent: unique(user_id, course_id) on user_courses means a repeat
  // call (e.g. two poll ticks landing back-to-back) just hits a conflict,
  // which we swallow as "already granted".
  try {
    await svc('POST', '/user_courses', {
      user_id:          order.user_id,
      course_id:        order.course_id,
      payment_status:   'completed',
      purchased_price:  order.amount,
    });
  } catch (err) {
    const msg = String(err.message);
    if (!msg.includes('409') && !msg.includes('23505')) throw err;
  }

  await svc('POST', '/user_activity', {
    user_id:       order.user_id,
    activity_type: 'course_purchase',
    course_id:     order.course_id,
    metadata: {
      provider:           order.provider,
      order_id:           order.order_id,
      provider_order_id:  providerOrderId,
      amount:              order.amount,
    },
  });
}

// ─── Provider status checkers ────────────────────────────────────────────────
async function checkRazorpay(order) {
  const keyId = isTestMode
    ? (process.env.RAZORPAY_TEST_KEY_ID     || process.env.RAZORPAY_KEY_ID)
    : process.env.RAZORPAY_KEY_ID;
  const keySecret = isTestMode
    ? (process.env.RAZORPAY_TEST_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET)
    : process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error('Razorpay credentials missing');

  const res = await fetch(
    `https://api.razorpay.com/v1/orders?receipt=${encodeURIComponent(order.order_id)}&count=1`,
    { headers: { 'Authorization': 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64') } }
  );
  const data = await res.json();
  if (!res.ok) throw new Error('Razorpay fetch error: ' + JSON.stringify(data));

  const rzpOrder = data.items?.[0];
  if (!rzpOrder || rzpOrder.status !== 'paid') {
    return { paid: false, status: rzpOrder?.status || 'not_found' };
  }

  return { paid: true, provider_order_id: rzpOrder.id, amount: rzpOrder.amount / 100 };
}

async function checkPaypal(order) {
  const clientId = isTestMode
    ? (process.env.PAYPAL_SANDBOX_CLIENT_ID     || process.env.PAYPAL_CLIENT_ID)
    : process.env.PAYPAL_CLIENT_ID;
  const clientSecret = isTestMode
    ? (process.env.PAYPAL_SANDBOX_CLIENT_SECRET || process.env.PAYPAL_CLIENT_SECRET)
    : process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('PayPal credentials missing');
  if (!order.provider_order_id) throw new Error('No PayPal order id stored for this order');

  const ppBase = isTestMode ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';

  const tokenRes = await fetch(`${ppBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) throw new Error('PayPal token fetch failed');
  const authHeader = { 'Authorization': `Bearer ${tokenData.access_token}` };

  const getRes = await fetch(`${ppBase}/v2/checkout/orders/${order.provider_order_id}`, { headers: authHeader });
  let ppOrder = await getRes.json();
  if (!getRes.ok) throw new Error('PayPal order fetch failed: ' + JSON.stringify(ppOrder));

  // Buyer approved on PayPal's site but funds aren't captured yet — capture now.
  if (ppOrder.status === 'APPROVED') {
    const captureRes = await fetch(`${ppBase}/v2/checkout/orders/${order.provider_order_id}/capture`, {
      method:  'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
    });
    const captureData = await captureRes.json();
    if (!captureRes.ok) throw new Error('PayPal capture failed: ' + JSON.stringify(captureData));
    ppOrder = captureData;
  }

  if (ppOrder.status !== 'COMPLETED') {
    return { paid: false, status: ppOrder.status || 'not_found' };
  }

  const capture = ppOrder.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    paid:              true,
    provider_order_id: ppOrder.id,
    amount:            parseFloat(capture?.amount?.value || order.amount),
  };
}

// ─── Main handler ────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { order_id } = req.body || {};
  if (!order_id) return res.status(400).json({ error: 'Missing order_id' });

  try {
    const order = await getOrder(order_id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Idempotent short-circuits
    if (order.status === 'paid') {
      return res.status(200).json({ paid: true, status: 'paid', course_id: order.course_id });
    }
    if (order.status === 'failed') {
      return res.status(200).json({ paid: false, status: 'failed' });
    }

    let result;
    try {
      result = order.provider === 'razorpay' ? await checkRazorpay(order) : await checkPaypal(order);
    } catch (err) {
      console.error(`[verify-order] provider check error (${order.provider}):`, err.message);
      // Provider hiccup — report pending, not failed, so the client keeps polling.
      return res.status(200).json({ paid: false, status: 'pending', error: err.message });
    }

    if (!result.paid) {
      return res.status(200).json({ paid: false, status: result.status || 'pending' });
    }

    await grantCourseAccess(order, result.provider_order_id);
    await updateOrder(order_id, { status: 'paid', provider_order_id: result.provider_order_id });

    console.log(`[verify-order] ${order_id} PAID — course ${order.course_id} granted to user ${order.user_id}`);

    return res.status(200).json({ paid: true, status: 'paid', course_id: order.course_id });

  } catch (err) {
    console.error('[verify-order]', err);
    return res.status(500).json({ error: err.message });
  }
}
