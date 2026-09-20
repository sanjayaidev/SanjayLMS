// POST /api/prebook  { name, phone, email, items: ["m1","m4"] | ["full"] }
// Prices are read from the courses table. The browser never decides the amount.
import crypto from 'node:crypto';
import { cors, sb, razorpayOrder, readJson } from './_lib.mjs';

const MODULE_KEYS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'];
const VALID_KEY = /^(m[1-8]|full)$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const b = readJson(req);
    const name = String(b.name || '').trim().slice(0, 120);
    const email = String(b.email || '').trim().toLowerCase().slice(0, 255);
    const phone = String(b.phone || '').replace(/\D/g, '').slice(-10);
    const items = Array.isArray(b.items) ? [...new Set(b.items.map(String))] : [];

    if (!name) return res.status(400).json({ error: 'Enter your name.' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (phone.length !== 10) return res.status(400).json({ error: 'Enter a valid 10-digit WhatsApp number.' });
    if (!items.length || !items.every((k) => VALID_KEY.test(k))) {
      return res.status(400).json({ error: 'Pick at least one module.' });
    }

    const rows = await sb('courses?prebook_key=not.is.null&select=id,prebook_key,price');
    const byKey = Object.fromEntries(rows.map((r) => [r.prebook_key, r]));
    if (!byKey.full || MODULE_KEYS.some((k) => !byKey[k])) {
      return res.status(500).json({ error: 'Prebooking is not set up yet. Please message us on WhatsApp.' });
    }

    // Price rules: "full" wins; otherwise sum the modules, and never charge more than the bundle.
    let keys = items.includes('full') ? ['full'] : items;
    let amount = keys.reduce((sum, k) => sum + Number(byKey[k].price), 0);
    let bundle = keys.includes('full');
    if (!bundle && amount >= Number(byKey.full.price)) {
      keys = ['full'];
      amount = Number(byKey.full.price);
      bundle = true;
    }
    const courseIds = (bundle ? MODULE_KEYS : keys).map((k) => byKey[k].id);

    const order = await razorpayOrder({
      amount: Math.round(amount * 100), // paise
      currency: 'INR',
      receipt: 'pb_' + crypto.randomBytes(8).toString('hex'),
      notes: { email, phone, items: keys.join(',') },
    });

    await sb('prebookings', {
      method: 'POST',
      body: {
        email,
        full_name: name,
        phone,
        course_ids: courseIds,
        amount,
        razorpay_order_id: order.id,
      },
    });

    return res.status(200).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      total: amount,
      bundleApplied: bundle,
    });
  } catch (err) {
    console.error('prebook error:', err);
    return res.status(500).json({ error: 'Could not start payment. Please try again or message us on WhatsApp.' });
  }
}
