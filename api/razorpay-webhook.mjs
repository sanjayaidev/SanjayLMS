// POST /api/razorpay-webhook
// Safety net for buyers who pay and then close the tab before /api/prebook-verify runs.
// Register in Razorpay Dashboard > Webhooks, events: payment.captured, order.paid.
import crypto from 'node:crypto';
import { markPaid, safeEqual } from './_lib.mjs';

// Razorpay signs the exact raw bytes, so JSON parsing must be off for this route.
export const config = { api: { bodyParser: false } };

async function rawBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const buf = await rawBody(req);
    const sig = req.headers['x-razorpay-signature'];
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(buf)
      .digest('hex');

    if (!sig || !safeEqual(sig, expected)) return res.status(400).end();

    const evt = JSON.parse(buf.toString('utf8'));
    if (evt.event === 'payment.captured' || evt.event === 'order.paid') {
      const p = evt.payload?.payment?.entity;
      if (p?.order_id) await markPaid(p.order_id, p.id);
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('razorpay-webhook error:', err);
    return res.status(500).end(); // Razorpay retries on non-2xx
  }
}
