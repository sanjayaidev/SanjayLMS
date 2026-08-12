// /api/enroll-free.js
//
// Grants access to a $0 / free course without going through a payment
// gateway. This exists because the RLS migration in schema-payments.sql
// removes the client's ability to insert directly into user_courses (that
// was the hole that let anyone grant themselves any course for free) — so
// free courses need their own explicit, server-verified path.

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY       = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

async function getUser(token) {
  if (!token) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user  = await getUser(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated', code: 'AUTH_REQUIRED' });

  const { course_id } = req.body || {};
  if (!course_id) return res.status(400).json({ error: 'Missing course_id' });

  const courses = await svc('GET', `/courses?id=eq.${course_id}&is_active=eq.true&select=id,price&limit=1`);
  const course  = courses?.[0];
  if (!course) return res.status(404).json({ error: 'Course not found' });

  const price = parseFloat(course.price);
  if (Number.isFinite(price) && price > 0) {
    return res.status(400).json({
      error: 'This course is not free — use /api/create-order instead',
      code:  'COURSE_NOT_FREE',
    });
  }

  try {
    await svc('POST', '/user_courses', {
      user_id:         user.id,
      course_id,
      payment_status:  'completed',
      purchased_price: 0,
    });
  } catch (err) {
    const msg = String(err.message);
    if (!msg.includes('409') && !msg.includes('23505')) throw err; // treat "already enrolled" as success
  }

  await svc('POST', '/user_activity', {
    user_id:       user.id,
    activity_type: 'course_purchase',
    course_id,
    metadata: { free: true },
  });

  return res.status(200).json({ success: true });
}
