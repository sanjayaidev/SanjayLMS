-- ============================================
-- Migration: Link course_downloads to a specific module
-- ============================================
-- Problem: course_downloads only had course_id, so every resource showed
-- in every module's download list for that course, with no way to attach
-- a file to (e.g.) "Module 1" specifically.
--
-- Fix: add a nullable module_id. When set, the download belongs to that
-- module only. When left NULL, it's treated as a course-wide resource
-- (e.g. a full syllabus PDF) rather than a Module 1-only file.
-- ============================================

ALTER TABLE course_downloads
    ADD COLUMN IF NOT EXISTS module_id UUID REFERENCES course_modules(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_course_downloads_module_id ON course_downloads(module_id);

-- Sanity check: module_id, if set, must belong to the same course as the
-- download row itself (prevents attaching a Module 3 file from Course A
-- to Course B by mistake).
CREATE OR REPLACE FUNCTION check_download_module_course_match()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.module_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM course_modules
            WHERE id = NEW.module_id AND course_id = NEW.course_id
        ) THEN
            RAISE EXCEPTION 'module_id % does not belong to course_id %', NEW.module_id, NEW.course_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_download_module_course_match ON course_downloads;
CREATE TRIGGER trg_check_download_module_course_match
    BEFORE INSERT OR UPDATE ON course_downloads
    FOR EACH ROW EXECUTE FUNCTION check_download_module_course_match();
