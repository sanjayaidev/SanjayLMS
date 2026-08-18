// /api/admin-grant-access.js
//
// Admin-only endpoint used by admin.html's "Grant Course Access" modal.
// Given a student email + a course_id it will:
//   1. Verify the caller is an admin (same email allow-list admin.js uses
//      client-side — enforced here again because the client check is
//      cosmetic and can't be trusted).
//   2. Find the student's profile by email, or create a brand-new account
//      for them (via Supabase's admin invite endpoint) if one doesn't exist.
//   3. Grant them access to the course by writing to user_courses, the same
//      way /api/enroll-free and /api/verify-order do.
//   4. Best-effort email them that they now have access (via Resend, if
//      RESEND_API_KEY is configured). A brand-new student additionally gets
//      Supabase's own invite email (to set a password), sent automatically
//      by step 2.
//
// This is the only place besides enroll-free/verify-order that is allowed
// to write to user_courses — it does so with the service role key, so it
// bypasses RLS. Every write is guarded by the admin check above.

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY       = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Optional — if unset, course-access emails are skipped (access is still
// granted; the response just reports email_sent: false so the admin UI can
// tell the admin to notify the student manually).
const RESEND_API_KEY  = process.env.RESEND_API_KEY;
const RESEND_FROM     = process.env.RESEND_FROM_EMAIL || 'Sanjay Meher <sanjay@mail.sanjaymeher.online>';

// Same allow-list admin.js checks client-side. Override with a comma
// separated ADMIN_EMAILS env var without touching code.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'graphicyin@gmail.com')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

const SITE_URL = process.env.SITE_URL || 'https://aicourse.sanjaymeher.online';

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

// Creates a brand-new auth user AND sends them Supabase's built-in invite
// email (a magic link that lets them set a password) in one call — no extra
// email service needed for this part.
async function inviteUser(email, fullName) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/invite`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({
      email,
      data: fullName ? { full_name: fullName } : undefined,
    }),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`Supabase invite -> ${res.status}: ${text}`);
  return data; // { id, email, ... }
}

async function sendCourseAccessEmail(toEmail, courseTitle, isNewUser) {
  if (!RESEND_API_KEY) return false;

  const loginUrl = `${SITE_URL}/login`;
  const heading = isNewUser
    ? `Welcome! You've been enrolled in "${courseTitle}"`
    : `You now have access to "${courseTitle}"`;
  const bodyIntro = isNewUser
    ? `An account has been created for you and you've been given access to <strong>${courseTitle}</strong>. Check your inbox for a separate email to set your password, then log in below.`
    : `You've been given access to <strong>${courseTitle}</strong>. Log in to start learning.`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>${heading}</h2>
      <p>${bodyIntro}</p>
      <p style="margin: 24px 0;">
        <a href="${loginUrl}" style="background:#667eea;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block;">
          Go to your course
        </a>
      </p>
      <p style="color:#888;font-size:12px;">If the button doesn't work, visit ${loginUrl}</p>
    </div>
  `;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from:    RESEND_FROM,
      to:      [toEmail],
      subject: heading,
      html,
    }),
  });

  if (!res.ok) {
    console.error('[admin-grant-access] Resend error:', res.status, await res.text());
    return false;
  }
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const missingBase = [];
  if (!SUPABASE_URL)      missingBase.push('SUPABASE_URL');
  if (!SUPABASE_ANON_KEY) missingBase.push('SUPABASE_ANON_KEY');
  if (!SERVICE_KEY)       missingBase.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missingBase.length) {
    console.error('[admin-grant-access] missing required env vars:', missingBase.join(', '));
    return res.status(500).json({
      error: `Server misconfigured — missing env var(s): ${missingBase.join(', ')}. Set these in Vercel Project Settings → Environment Variables and redeploy.`,
      code:  'MISSING_ENV',
    });
  }

  // ── Auth: caller must be a logged-in admin ────────────────────────────
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const caller = await getUser(token);
  if (!caller) return res.status(401).json({ error: 'Not authenticated', code: 'AUTH_REQUIRED' });
  if (!ADMIN_EMAILS.includes((caller.email || '').toLowerCase())) {
    return res.status(403).json({ error: 'Admin access required', code: 'NOT_ADMIN' });
  }

  // ── Input validation ───────────────────────────────────────────────────
  const { email, course_id, full_name, send_email = true } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: 'Valid student email is required' });
  }
  if (!course_id) return res.status(400).json({ error: 'Missing course_id' });

  const courses = await svc('GET', `/courses?id=eq.${course_id}&select=id,title&limit=1`);
  const course  = courses?.[0];
  if (!course) return res.status(404).json({ error: 'Course not found' });

  // ── Find or create the student ─────────────────────────────────────────
  let userId;
  let isNewUser = false;

  const existing = await svc('GET', `/profiles?email=eq.${encodeURIComponent(cleanEmail)}&select=id,email&limit=1`);
  if (existing?.[0]) {
    userId = existing[0].id;
  } else {
    let invited;
    try {
      invited = await inviteUser(cleanEmail, full_name);
    } catch (err) {
      return res.status(500).json({ error: `Could not create student account: ${err.message}` });
    }
    userId = invited.id;
    isNewUser = true;

    // Belt-and-braces: make sure a profiles row exists even if the project's
    // "create profile on signup" trigger isn't set up. Harmless no-op if it
    // already exists (upsert on primary key).
    try {
      await svc('POST', '/profiles', {
        id:    userId,
        email: cleanEmail,
        full_name: full_name || null,
      });
    } catch (err) {
      // Ignore "already exists" (23505) — the trigger got there first.
      if (!String(err.message).includes('23505')) {
        console.error('[admin-grant-access] profile upsert warning:', err.message);
      }
    }
  }

  // ── Grant course access ────────────────────────────────────────────────
  try {
    await svc('POST', '/user_courses', {
      user_id:         userId,
      course_id,
      payment_status:  'completed',
      purchased_price: 0,
    });
  } catch (err) {
    const msg = String(err.message);
    if (!msg.includes('409') && !msg.includes('23505')) throw err; // already enrolled = fine
  }

  await svc('POST', '/user_activity', {
    user_id:       userId,
    activity_type: 'course_purchase',
    course_id,
    metadata: { granted_by_admin: true, admin_email: caller.email },
  });

  // ── Notify the student (best effort — never fails the request) ────────
  let emailSent = false;
  if (send_email) {
    try {
      emailSent = await sendCourseAccessEmail(cleanEmail, course.title, isNewUser);
    } catch (err) {
      console.error('[admin-grant-access] email send failed:', err.message);
    }
  }

  return res.status(200).json({
    success:      true,
    is_new_user:  isNewUser,
    email_sent:   emailSent,
    email_configured: !!RESEND_API_KEY,
  });
}
