-- ============================================
-- AICreator prebooking  (run in Supabase SQL editor)
-- Safe to re-run: uses IF NOT EXISTS / ON CONFLICT where possible.
-- ============================================

-- 1) Key that the landing page uses to refer to each course (m1..m8, full)
ALTER TABLE courses ADD COLUMN IF NOT EXISTS prebook_key VARCHAR(10) UNIQUE;

-- 2) One course row per AICreator module + one row for the bundle price.
--    is_active = false keeps them out of the student catalog until content is live.
--    The 'full' row is only used for its price; buyers of the bundle receive m1..m8.
INSERT INTO courses (title, description, price, required_tier, is_active, prebook_key) VALUES
  ('AICreator Module 1 — Client-Ready AI Images: Generate, Then Fix by Hand',            'Prebooked module. Lessons are added as they go live.', 299,  'basic', false, 'm1'),
  ('AICreator Module 2 — Avatars, Voice Cloning & Lipsync: The Free Stack',             'Prebooked module. Lessons are added as they go live.', 299,  'basic', false, 'm2'),
  ('AICreator Module 3 — 2D Animation & Motion Graphics: Template + Code',              'Prebooked module. Lessons are added as they go live.', 299,  'basic', false, 'm3'),
  ('AICreator Module 4 — 3D Product Animation: Template-First, No 3D Background Needed','Prebooked module. Lessons are added as they go live.', 299,  'basic', false, 'm4'),
  ('AICreator Module 5 — Wedding & Event Invites, Cards + a Template Store You Can Sell From','Prebooked module. Lessons are added as they go live.', 299, 'basic', false, 'm5'),
  ('AICreator Module 6 — Long-Form AI Film: Lock Consistency in Images, Then Animate',  'Prebooked module. Lessons are added as they go live.', 299,  'basic', false, 'm6'),
  ('AICreator Module 7 — Storyboard → Edit → Deliver: Professional Editing',            'Prebooked module. Lessons are added as they go live.', 299,  'basic', false, 'm7'),
  ('AICreator Module 8 — Build Your Own Free AI Tool: APIs, Web App, Deployment',       'Prebooked module. Lessons are added as they go live.', 299,  'basic', false, 'm8'),
  ('AICreator — Full Package (all 8 modules)',                                          'Bundle price row. Buyers receive Modules 1-8.',        1499, 'basic', false, 'full')
ON CONFLICT (prebook_key) DO NOTHING;

-- 3) Prebookings: a paid booking that exists before the buyer has an account
CREATE TABLE IF NOT EXISTS prebookings (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email                VARCHAR(255) NOT NULL,            -- always stored lowercased
  full_name            VARCHAR(255),
  phone                VARCHAR(20) NOT NULL,
  course_ids           UUID[] NOT NULL,                  -- the courses this booking unlocks
  amount               DECIMAL(10, 2) NOT NULL,          -- INR, computed server-side
  status               VARCHAR(20) NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'paid', 'claimed', 'refunded')),
  razorpay_order_id    TEXT UNIQUE,
  razorpay_payment_id  TEXT,
  paid_at              TIMESTAMP WITH TIME ZONE,
  claimed_by           UUID REFERENCES profiles(id) ON DELETE SET NULL,
  claimed_at           TIMESTAMP WITH TIME ZONE,
  created_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prebookings_email  ON prebookings(email);
CREATE INDEX IF NOT EXISTS idx_prebookings_status ON prebookings(status);

-- Only the server (service-role key) writes here. No public policies.
-- The only read policy is for the admin, matching the pattern already used on profiles.
ALTER TABLE prebookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin can view prebookings" ON prebookings;
CREATE POLICY "Admin can view prebookings"
ON prebookings FOR SELECT
USING (COALESCE(auth.jwt() ->> 'email', '') = 'graphicyin@gmail.com');

-- 4) Claim: turns paid prebookings into real course access for the logged-in user.
--    Requires a VERIFIED email so nobody can sign up with someone else's address and claim it.
CREATE OR REPLACE FUNCTION public.claim_prebookings()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_email     TEXT;
  v_confirmed TIMESTAMP WITH TIME ZONE;
  v_claimed   INTEGER := 0;
  r           RECORD;
  cid         UUID;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 0;
  END IF;

  SELECT lower(email), email_confirmed_at
    INTO v_email, v_confirmed
    FROM auth.users
   WHERE id = v_uid;

  IF v_email IS NULL OR v_confirmed IS NULL THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT * FROM prebookings
     WHERE email = v_email AND status = 'paid'
       FOR UPDATE
  LOOP
    FOREACH cid IN ARRAY r.course_ids LOOP
      INSERT INTO user_courses (user_id, course_id, payment_status)
      VALUES (v_uid, cid, 'completed')
      ON CONFLICT (user_id, course_id)
      DO UPDATE SET payment_status = 'completed';
    END LOOP;

    UPDATE prebookings
       SET status = 'claimed', claimed_by = v_uid, claimed_at = NOW()
     WHERE id = r.id;

    v_claimed := v_claimed + 1;
  END LOOP;

  RETURN v_claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_prebookings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_prebookings() TO authenticated;

-- ============================================
-- 5) CLOSE THE FREE-COURSE HOLE  (run this as a separate step, see PREBOOKING.md)
--    Today any logged-in user can INSERT their own user_courses row with
--    payment_status = 'completed'. Once real payments are wired, remove that:
-- ============================================
-- DROP POLICY "Users can insert their own course purchases" ON user_courses;
