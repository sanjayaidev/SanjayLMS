-- ============================================
-- Migration: stop leaking course_modules.video_url to anyone who can query
-- the table directly, while keeping module browsing (title/description/
-- order/preview flag) public for logged-in users.
--
-- Run this AFTER add-module-preview.sql (it relies on the is_preview column).
-- Safe to re-run: uses CREATE OR REPLACE / DROP POLICY IF EXISTS.
--
-- IMPORTANT: replace 'graphicyin@gmail.com' below with your real admin
-- email(s) if different — it must match ADMIN_EMAILS / adminEmails in
-- admin.js so the admin panel keeps working.
-- ============================================

-- ------------------------------------------------------------------
-- 1. Lock the base table down to admins only.
--    Previously "Anyone can view active modules..." let any authenticated
--    (or even anon) client run `select * from course_modules`, which
--    included video_url for every module — locked ones included.
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view active modules from active courses" ON course_modules;

CREATE POLICY "Only admins can read course_modules directly"
    ON course_modules FOR SELECT
    USING (
        COALESCE(auth.jwt() ->> 'email', '') = 'graphicyin@gmail.com'
    );

-- The admin panel creates/edits/deletes modules but the original schema
-- never actually granted it permission to do so under RLS. Adding that
-- here too since it's the same table and the same admin check.
DROP POLICY IF EXISTS "Admins can insert course_modules" ON course_modules;
CREATE POLICY "Admins can insert course_modules"
    ON course_modules FOR INSERT
    WITH CHECK (COALESCE(auth.jwt() ->> 'email', '') = 'graphicyin@gmail.com');

DROP POLICY IF EXISTS "Admins can update course_modules" ON course_modules;
CREATE POLICY "Admins can update course_modules"
    ON course_modules FOR UPDATE
    USING (COALESCE(auth.jwt() ->> 'email', '') = 'graphicyin@gmail.com')
    WITH CHECK (COALESCE(auth.jwt() ->> 'email', '') = 'graphicyin@gmail.com');

DROP POLICY IF EXISTS "Admins can delete course_modules" ON course_modules;
CREATE POLICY "Admins can delete course_modules"
    ON course_modules FOR DELETE
    USING (COALESCE(auth.jwt() ->> 'email', '') = 'graphicyin@gmail.com');

-- ------------------------------------------------------------------
-- 2. Public listing view — everything students need to browse a
--    syllabus (title, description, order, duration, tier, preview flag)
--    with video_url deliberately left out. Views are owner-executed by
--    default (security_invoker = false), so it still works even though
--    the base table's SELECT policy above is admin-only.
-- ------------------------------------------------------------------
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
    cm.updated_at
FROM course_modules cm
JOIN courses c ON c.id = cm.course_id
WHERE cm.is_active = true AND c.is_active = true;

GRANT SELECT ON course_modules_public TO anon, authenticated;

-- ------------------------------------------------------------------
-- 3. Secure RPC — the ONLY way to get a playable video_url.
--    Returns the URL if:
--      a) the module is flagged is_preview, OR
--      b) the caller purchased the course (payment_status = 'completed')
--         AND their subscription tier meets the module's required_tier.
--    Returns NULL in every other case (not logged in, not purchased,
--    tier too low, module/course inactive, module not found).
-- ------------------------------------------------------------------
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
    v_has_purchased BOOLEAN;
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

    -- Otherwise the course must be purchased.
    SELECT EXISTS (
        SELECT 1 FROM user_courses
        WHERE user_id = auth.uid()
          AND course_id = v_course_id
          AND payment_status = 'completed'
    ) INTO v_has_purchased;

    IF NOT v_has_purchased THEN
        RETURN NULL;
    END IF;

    -- And the caller's tier must meet the module's required tier.
    SELECT subscription_tier INTO v_user_tier FROM profiles WHERE id = auth.uid();

    v_tier_level := CASE COALESCE(v_user_tier, 'basic') WHEN 'premium' THEN 2 ELSE 1 END;
    v_module_tier_level := CASE COALESCE(v_required_tier, 'basic') WHEN 'premium' THEN 2 ELSE 1 END;

    IF v_tier_level < v_module_tier_level THEN
        RETURN NULL;
    END IF;

    RETURN v_video_url;
END;
$$;

-- Only logged-in users may call it; anonymous callers get nothing anyway
-- since the function itself checks auth.uid(), but revoking EXECUTE from
-- anon closes it off at the grant level too.
REVOKE ALL ON FUNCTION get_module_video_url(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_module_video_url(UUID) TO authenticated;
