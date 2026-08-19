-- Migration: Add know_more_url to courses
-- Public "Know More" link shown on the homepage course catalog for each
-- course (e.g. a sales page, syllabus PDF, or promo video). Nullable —
-- when not set, the homepage falls back to the course's own detail page.

ALTER TABLE courses ADD COLUMN IF NOT EXISTS know_more_url TEXT;
