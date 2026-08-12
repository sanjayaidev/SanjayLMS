-- ============================================
-- Migration: add is_preview to course_modules for free "course preview" module(s)
-- A module flagged is_preview = true can be watched by ANY logged-in user,
-- even if they have not purchased the course (and regardless of required_tier).
-- Safe to run on an already-deployed database — uses IF NOT EXISTS.
-- ============================================

ALTER TABLE course_modules ADD COLUMN IF NOT EXISTS is_preview BOOLEAN DEFAULT false;

COMMENT ON COLUMN course_modules.is_preview IS 'If true, this module can be previewed by any logged-in user without purchasing the course';

-- Optional convenience index if you plan to query "give me the preview module for course X" directly
CREATE INDEX IF NOT EXISTS idx_course_modules_is_preview ON course_modules(course_id, is_preview) WHERE is_preview = true;

-- Suggested one-time data fix: mark the first module (module_order = 1, or the lowest order)
-- of every existing course as a free preview. Uncomment and run if you want this automatically:
--
-- UPDATE course_modules cm
-- SET is_preview = true
-- WHERE cm.id = (
--     SELECT id FROM course_modules
--     WHERE course_id = cm.course_id AND is_active = true
--     ORDER BY module_order ASC
--     LIMIT 1
-- );
