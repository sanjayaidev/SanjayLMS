-- ============================================
-- MODULE LESSONS — turns each module into its own mini-course of videos
-- Run this AFTER migrations/add-modular-course-purchases.sql.
--
-- Access model does NOT change: purchase/ownership is still decided at the
-- MODULE level (user_courses / user_course_modules, has_module_access()).
-- A lesson is just a video that lives inside a module — if you can access
-- the module, you can access every lesson in it. This keeps pricing simple:
-- you still sell "Module 2 — ₹299", not individual lessons.
--
-- Backward compatible: course_modules.video_url is left in place. A module
-- with no rows in module_lessons still plays its own video_url directly
-- (single-video module, exactly like before). A module WITH lessons plays
-- those instead and its own video_url is ignored.
-- ============================================

-- ============================================
-- 1. MODULE_LESSONS
-- ============================================
CREATE TABLE IF NOT EXISTS module_lessons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    module_id UUID NOT NULL REFERENCES course_modules(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    video_url TEXT,
    duration VARCHAR(50),
    lesson_order INTEGER NOT NULL DEFAULT 0,
    -- A lesson can be flagged as its own free preview (e.g. lesson 1 of a
    -- paid module), independent of the parent module's is_preview flag.
    is_preview BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_module_lessons_module_id ON module_lessons(module_id);
CREATE INDEX IF NOT EXISTS idx_module_lessons_order ON module_lessons(module_id, lesson_order);

DROP TRIGGER IF EXISTS update_module_lessons_updated_at ON module_lessons;
CREATE TRIGGER update_module_lessons_updated_at
    BEFORE UPDATE ON module_lessons
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE module_lessons ENABLE ROW LEVEL SECURITY;

-- Locked down the same way course_modules is (see secure-module-video-url.sql):
-- video_url must never be readable directly. Browsing happens through the
-- module_lessons_public view below; playback happens through
-- get_lesson_video_url() further down.
-- Replace 'graphicyin@gmail.com' if your admin email differs — must match
-- ADMIN_EMAILS / adminEmails in admin.js.
DROP POLICY IF EXISTS "Only admins can read module_lessons directly" ON module_lessons;
CREATE POLICY "Only admins can read module_lessons directly"
    ON module_lessons FOR SELECT
    USING (COALESCE(auth.jwt() ->> 'email', '') = 'graphicyin@gmail.com');

DROP POLICY IF EXISTS "Admins can insert module_lessons" ON module_lessons;
CREATE POLICY "Admins can insert module_lessons"
    ON module_lessons FOR INSERT
    WITH CHECK (COALESCE(auth.jwt() ->> 'email', '') = 'graphicyin@gmail.com');

DROP POLICY IF EXISTS "Admins can update module_lessons" ON module_lessons;
CREATE POLICY "Admins can update module_lessons"
    ON module_lessons FOR UPDATE
    USING (COALESCE(auth.jwt() ->> 'email', '') = 'graphicyin@gmail.com')
    WITH CHECK (COALESCE(auth.jwt() ->> 'email', '') = 'graphicyin@gmail.com');

DROP POLICY IF EXISTS "Admins can delete module_lessons" ON module_lessons;
CREATE POLICY "Admins can delete module_lessons"
    ON module_lessons FOR DELETE
    USING (COALESCE(auth.jwt() ->> 'email', '') = 'graphicyin@gmail.com');

-- Public listing view — title/description/order/duration/preview flag only,
-- video_url deliberately excluded. Same pattern as course_modules_public.
CREATE OR REPLACE VIEW module_lessons_public
WITH (security_invoker = false) AS
SELECT
    ml.id,
    ml.module_id,
    ml.title,
    ml.description,
    ml.duration,
    ml.lesson_order,
    ml.is_preview,
    ml.is_active,
    ml.created_at,
    ml.updated_at
FROM module_lessons ml
JOIN course_modules cm ON cm.id = ml.module_id
WHERE ml.is_active = true AND cm.is_active = true;

GRANT SELECT ON module_lessons_public TO anon, authenticated;

-- ============================================
-- 2. USER_PROGRESS — extend to track completion per lesson
-- ============================================
-- The old UNIQUE(user_id, module_id) constraint assumed one progress row
-- per module. With lessons, a module can have many completion rows (one
-- per lesson), so that constraint has to go — replaced by two constraints
-- that each cover one case cleanly:
--   - a module WITHOUT lessons still gets one progress row (lesson_id NULL)
--   - a module WITH lessons gets one progress row PER LESSON (lesson_id set)
ALTER TABLE user_progress
    ADD COLUMN IF NOT EXISTS lesson_id UUID REFERENCES module_lessons(id) ON DELETE CASCADE;

ALTER TABLE user_progress DROP CONSTRAINT IF EXISTS user_progress_user_id_module_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_progress_module_no_lesson
    ON user_progress(user_id, module_id) WHERE lesson_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_progress_lesson
    ON user_progress(user_id, lesson_id) WHERE lesson_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_progress_lesson_id ON user_progress(lesson_id);

-- ============================================
-- 3. Secure RPC — the ONLY way to get a playable lesson video_url.
--    Access is decided by the PARENT MODULE, not the lesson: a lesson
--    unlocks if either the lesson itself or its module is a free preview,
--    or if the caller owns the module (a la carte) or the whole course
--    (with tier check) — i.e. exactly has_module_access(), reused here.
-- ============================================
CREATE OR REPLACE FUNCTION get_lesson_video_url(p_lesson_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_video_url TEXT;
    v_module_id UUID;
    v_course_id UUID;
    v_lesson_is_preview BOOLEAN;
    v_module_is_preview BOOLEAN;
    v_required_tier TEXT;
    v_lesson_active BOOLEAN;
    v_module_active BOOLEAN;
    v_course_active BOOLEAN;
    v_has_purchased_module BOOLEAN;
    v_has_purchased_course BOOLEAN;
    v_user_tier TEXT;
    v_tier_level INT;
    v_module_tier_level INT;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT video_url, module_id, is_preview, is_active
    INTO v_video_url, v_module_id, v_lesson_is_preview, v_lesson_active
    FROM module_lessons
    WHERE id = p_lesson_id;

    IF NOT FOUND OR v_lesson_active IS NOT TRUE THEN
        RETURN NULL;
    END IF;

    SELECT course_id, is_preview, required_tier, is_active
    INTO v_course_id, v_module_is_preview, v_required_tier, v_module_active
    FROM course_modules
    WHERE id = v_module_id;

    IF v_module_active IS NOT TRUE THEN
        RETURN NULL;
    END IF;

    SELECT is_active INTO v_course_active FROM courses WHERE id = v_course_id;
    IF v_course_active IS NOT TRUE THEN
        RETURN NULL;
    END IF;

    -- Free preview: either the lesson itself, or the whole module, is flagged preview.
    IF v_lesson_is_preview OR v_module_is_preview THEN
        RETURN v_video_url;
    END IF;

    -- Path 1: bought this module a la carte — unlocks every lesson in it
    -- regardless of subscription tier.
    SELECT EXISTS (
        SELECT 1 FROM user_course_modules
        WHERE user_id = auth.uid() AND module_id = v_module_id AND payment_status = 'completed'
    ) INTO v_has_purchased_module;

    IF v_has_purchased_module THEN
        RETURN v_video_url;
    END IF;

    -- Path 2: bought the whole course — subject to the subscription-tier check.
    SELECT EXISTS (
        SELECT 1 FROM user_courses
        WHERE user_id = auth.uid() AND course_id = v_course_id AND payment_status = 'completed'
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

REVOKE ALL ON FUNCTION get_lesson_video_url(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_lesson_video_url(UUID) TO authenticated;

-- ============================================
-- USEFUL QUERIES
-- ============================================

-- Query: lessons for a module, in order (browsing — no video_url)
-- SELECT * FROM module_lessons_public WHERE module_id = 'MODULE_UUID' ORDER BY lesson_order;

-- Query: a user's per-lesson completion for a module
-- SELECT ml.id, ml.title, ml.lesson_order,
--        COALESCE(up.completed, false) AS completed
-- FROM module_lessons ml
-- LEFT JOIN user_progress up ON up.lesson_id = ml.id AND up.user_id = 'USER_UUID'
-- WHERE ml.module_id = 'MODULE_UUID' AND ml.is_active = true
-- ORDER BY ml.lesson_order;

-- Query: module completion % from its lessons (module has no direct
-- progress row once it has lessons — compute from the lesson rows instead)
-- SELECT
--     COUNT(*) FILTER (WHERE up.completed) * 100.0 / NULLIF(COUNT(*), 0) AS pct_complete
-- FROM module_lessons ml
-- LEFT JOIN user_progress up ON up.lesson_id = ml.id AND up.user_id = 'USER_UUID'
-- WHERE ml.module_id = 'MODULE_UUID' AND ml.is_active = true;
