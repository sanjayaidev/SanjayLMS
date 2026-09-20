// POST /api/prebook-verify  { razorpay_order_id, razorpay_payment_id, razorpay_signature }
// Called by the landing page right after Razorpay Checkout succeeds.
import { cors, readJson, verifyCheckoutSignature, markPaid } from './_lib.mjs';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const b = readJson(req);
    const orderId = String(b.razorpay_order_id || '');
    const paymentId = String(b.razorpay_payment_id || '');
    const signature = String(b.razorpay_signature || '');

    if (!orderId || !paymentId || !verifyCheckoutSignature(orderId, paymentId, signature)) {
      return res.status(400).json({ error: 'Payment could not be verified.' });
    }

    await markPaid(orderId, paymentId); // no-op if the webhook already did it
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('prebook-verify error:', err);
    return res.status(500).json({ error: 'Verification failed.' });
  }
}
