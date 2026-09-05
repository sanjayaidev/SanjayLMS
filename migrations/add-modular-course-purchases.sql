-- ============================================
-- MODULAR COURSE PURCHASES
-- Run this AFTER schema.sql and schema-payments.sql.
--
-- Adds support for courses sold like AICreator: a fixed "full package"
-- price on the course, PLUS a standalone price on each module so a buyer
-- can purchase just the modules they need instead of the whole course.
--
-- Ownership model after this migration:
--   - Owning the COURSE (user_courses, payment_status='completed') unlocks
--     every module in it, same as before.
--   - Owning a MODULE (user_course_modules, payment_status='completed')
--     unlocks just that module, even without owning the course.
-- A module is visible if EITHER is true. See has_module_access() below.
-- ============================================

-- ============================================
-- 1. Per-module pricing on course_modules
-- ============================================
ALTER TABLE course_modules
    ADD COLUMN IF NOT EXISTS price NUMERIC(10, 2),          -- INR standalone price, e.g. 299.00. NULL = not sellable alone.
    ADD COLUMN IF NOT EXISTS price_usd NUMERIC(10, 2),      -- USD standalone price (PayPal). NULL = PayPal disabled for this module.
    ADD COLUMN IF NOT EXISTS is_purchasable_standalone BOOLEAN DEFAULT true;

COMMENT ON COLUMN course_modules.price IS
    'Standalone INR price for buying just this module. NULL/0 means the module can only be reached by buying the whole course.';

-- ============================================
-- 2. USER_COURSE_MODULES — tracks a-la-carte module ownership
-- ============================================
CREATE TABLE IF NOT EXISTS user_course_modules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    module_id UUID NOT NULL REFERENCES course_modules(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,  -- denormalized for easy "my courses" queries
    payment_status VARCHAR(50) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'completed', 'failed', 'refunded')),
    purchased_price DECIMAL(10, 2),
    purchased_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, module_id)
);

CREATE INDEX IF NOT EXISTS idx_ucm_user_id ON user_course_modules(user_id);
CREATE INDEX IF NOT EXISTS idx_ucm_module_id ON user_course_modules(module_id);
CREATE INDEX IF NOT EXISTS idx_ucm_course_id ON user_course_modules(course_id);
CREATE INDEX IF NOT EXISTS idx_ucm_payment_status ON user_course_modules(payment_status);

ALTER TABLE user_course_modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own module purchases"
    ON user_course_modules FOR SELECT
    USING (auth.uid() = user_id);

-- Deliberately NO insert/update policy for authenticated users — exactly
-- like user_courses. Only /api/verify-order.js and /api/enroll-free.js
-- (service-role key) may write here, only after confirming real payment.

-- ============================================
-- 3. PAYMENT_ORDERS — extend to represent a cart of modules, not just
--    a single whole-course purchase
-- ============================================
ALTER TABLE payment_orders
    ADD COLUMN IF NOT EXISTS item_type VARCHAR(20) NOT NULL DEFAULT 'full_course'
        CHECK (item_type IN ('full_course', 'modules')),
    ADD COLUMN IF NOT EXISTS module_ids UUID[];  -- populated only when item_type = 'modules'

COMMENT ON COLUMN payment_orders.module_ids IS
    'When item_type=modules, the specific course_modules.id values this order paid for. NULL when item_type=full_course.';

-- ============================================
-- 4. Helper function: does this user currently have access to a module?
--    (owns the whole course OR owns this specific module)
-- ============================================
CREATE OR REPLACE FUNCTION has_module_access(p_user_id UUID, p_module_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_course_id UUID;
BEGIN
    SELECT course_id INTO v_course_id FROM course_modules WHERE id = p_module_id;

    RETURN EXISTS (
        SELECT 1 FROM user_courses
        WHERE user_id = p_user_id AND course_id = v_course_id AND payment_status = 'completed'
    ) OR EXISTS (
        SELECT 1 FROM user_course_modules
        WHERE user_id = p_user_id AND module_id = p_module_id AND payment_status = 'completed'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================
-- 5. Wire module-level ownership into the ACTUAL access gate.
--    Run this AFTER migrations/secure-module-video-url.sql, which is what
--    created course_modules_public and get_module_video_url() in the first
--    place. Without this step, a-la-carte purchases would update the
--    checkout/ownership tables but the video URL RPC would still say "no"
--    for anyone who didn't buy the whole course — the UI would look
--    unlocked while the video stayed inaccessible.
-- ============================================

-- 5a. Expose per-module pricing through the public listing view, so
--     course-detail.html can render "Add to order — ₹299" without needing
--     admin-only access to the base table.
-- IMPORTANT: Postgres only allows CREATE OR REPLACE VIEW to APPEND new
-- columns at the end of the SELECT list — it errors if an existing column
-- (like created_at below) appears to have "moved". So the new price /
-- price_usd / is_purchasable_standalone columns must go LAST, after
-- updated_at, even though that reads a little oddly.
CREATE OR REPLACE VIEW course_modules_public
WITH (security_invoker = false) AS
SELECT
    cm.id,
    cm.course_id,
    cm.title,
    cm.description,
    cm.duration,
    cm.module_order,
    cm.required_tier,
    cm.is_premium,
    cm.is_preview,
    cm.is_active,
    cm.created_at,
    cm.updated_at,
    cm.price,
    cm.price_usd,
    cm.is_purchasable_standalone
FROM course_modules cm
JOIN courses c ON c.id = cm.course_id
WHERE cm.is_active = true AND c.is_active = true;

GRANT SELECT ON course_modules_public TO anon, authenticated;

-- 5b. Replace the video-url RPC so a-la-carte module ownership unlocks a
--     module even when the whole course was never purchased. Course-level
--     ownership still works exactly as before (and still applies the
--     subscription-tier check); module-level ownership bypasses the tier
--     check, since the buyer paid for that module specifically.
CREATE OR REPLACE FUNCTION get_module_video_url(p_module_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_video_url TEXT;
    v_course_id UUID;
    v_is_preview BOOLEAN;
    v_required_tier TEXT;
    v_module_active BOOLEAN;
    v_course_active BOOLEAN;
    v_has_purchased_course BOOLEAN;
    v_has_purchased_module BOOLEAN;
    v_user_tier TEXT;
    v_tier_level INT;
    v_module_tier_level INT;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT video_url, course_id, is_preview, required_tier, is_active
    INTO v_video_url, v_course_id, v_is_preview, v_required_tier, v_module_active
    FROM course_modules
    WHERE id = p_module_id;

    IF NOT FOUND OR v_module_active IS NOT TRUE THEN
        RETURN NULL;
    END IF;

    SELECT is_active INTO v_course_active FROM courses WHERE id = v_course_id;
    IF v_course_active IS NOT TRUE THEN
        RETURN NULL;
    END IF;

    -- Free preview module: any logged-in user can watch it.
    IF v_is_preview THEN
        RETURN v_video_url;
    END IF;

    -- Path 1: bought this exact module a la carte — unlocks it regardless
    -- of subscription tier, since the buyer paid for this module specifically.
    SELECT EXISTS (
        SELECT 1 FROM user_course_modules
        WHERE user_id = auth.uid() AND module_id = p_module_id AND payment_status = 'completed'
    ) INTO v_has_purchased_module;

    IF v_has_purchased_module THEN
        RETURN v_video_url;
    END IF;

    -- Path 2: bought the whole course — same as before, still subject to
    -- the subscription-tier check.
    SELECT EXISTS (
        SELECT 1 FROM user_courses
        WHERE user_id = auth.uid()
          AND course_id = v_course_id
          AND payment_status = 'completed'
    ) INTO v_has_purchased_course;

    IF NOT v_has_purchased_course THEN
        RETURN NULL;
    END IF;

    SELECT subscription_tier INTO v_user_tier FROM profiles WHERE id = auth.uid();

    v_tier_level := CASE COALESCE(v_user_tier, 'basic') WHEN 'premium' THEN 2 ELSE 1 END;
    v_module_tier_level := CASE COALESCE(v_required_tier, 'basic') WHEN 'premium' THEN 2 ELSE 1 END;

    IF v_tier_level < v_module_tier_level THEN
        RETURN NULL;
    END IF;

    RETURN v_video_url;
END;
$$;

REVOKE ALL ON FUNCTION get_module_video_url(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_module_video_url(UUID) TO authenticated;

-- 5c. Same "which modules does this user own a la carte" info, exposed as
--     a lightweight RPC the frontend can call once per course-detail page
--     load (instead of relying on RLS-restricted direct table reads).
CREATE OR REPLACE FUNCTION get_my_owned_module_ids(p_course_id UUID)
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT module_id FROM user_course_modules
    WHERE user_id = auth.uid() AND course_id = p_course_id AND payment_status = 'completed';
$$;

REVOKE ALL ON FUNCTION get_my_owned_module_ids(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_my_owned_module_ids(UUID) TO authenticated;

-- ============================================
-- 6. Example: mark up an existing course + its modules for a-la-carte sale
-- ============================================
-- UPDATE courses SET price = 1499.00 WHERE title = 'AICreator';
-- UPDATE course_modules SET price = 299.00, is_purchasable_standalone = true
--     WHERE course_id = (SELECT id FROM courses WHERE title = 'AICreator');

-- ============================================
-- USEFUL QUERIES
-- ============================================

-- Query: modules a user can currently access in a course (owns course OR owns module)
-- SELECT cm.*, has_module_access('USER_UUID', cm.id) AS unlocked
-- FROM course_modules cm
-- WHERE cm.course_id = 'COURSE_UUID' AND cm.is_active = true
-- ORDER BY cm.module_order;

-- Query: total cost of a proposed cart of module ids, e.g. for server-side
-- price validation in /api/create-order.js
-- SELECT COALESCE(SUM(price), 0) AS total
-- FROM course_modules
-- WHERE id = ANY(ARRAY['MODULE_UUID_1','MODULE_UUID_2']::uuid[])
--   AND is_purchasable_standalone = true AND is_active = true;
