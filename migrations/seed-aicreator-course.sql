-- ============================================
-- SEED: AICreator — 8 recorded modules, full package or a-la-carte
-- Run this AFTER migrations/add-modular-course-purchases.sql.
--
-- Mirrors https://sanjaymeher.online/course/ai-video-course:
--   - Full package: ₹1,499
--   - Each module standalone: ₹299
--   - 8 modules, in order
--
-- Replace the video_url placeholders with real Mux/YouTube links before
-- going live. Re-running this file is NOT idempotent as written (it always
-- inserts a new course row) — delete the previous course first, or add a
-- WHERE NOT EXISTS guard, if you need to run it more than once.
-- ============================================

DO $$
DECLARE
    v_course_id UUID;
BEGIN
    INSERT INTO courses (title, description, price, price_usd, required_tier, is_active)
    VALUES (
        'AICreator',
        '8 recorded modules on AI video creation — images, avatars, animation, 3D, weddings, movies, editing & free API tools. Taught by Sanjay Meher, in Hindi. Buy the full package or just the modules you need.',
        1499.00,
        NULL,   -- set a USD price here if you want PayPal enabled for the full package
        'basic',
        true
    )
    RETURNING id INTO v_course_id;

    INSERT INTO course_modules
        (course_id, title, description, video_url, duration, module_order, required_tier, is_premium, is_preview, price, price_usd, is_purchasable_standalone)
    VALUES
        (v_course_id, 'Professional AI Image Generation',
         'Tool overview, prompting for photorealistic & stylized images, fixing/refining AI images in Photopea, and consistent characters & product shots.',
         'REPLACE_WITH_VIDEO_URL_1', NULL, 1, 'basic', false, false, 299.00, NULL, true),

        (v_course_id, 'AI Avatars, Cloning & Lipsync Videos',
         'Voice cloning & AI narration, lipsync avatar videos, talking-head explainers & ads, Synthesia-style avatar creation.',
         'REPLACE_WITH_VIDEO_URL_2', NULL, 2, 'basic', false, false, 299.00, NULL, true),

        (v_course_id, '2D Manual & AI Animation',
         'AI-assisted 2D animation basics, template-based animation (Animiz), manual touch-ups, motion graphics for ads.',
         'REPLACE_WITH_VIDEO_URL_3', NULL, 3, 'basic', false, false, 299.00, NULL, true),

        (v_course_id, '3D Blender Templates & AI Video Generation',
         'Blender basics for 3D visualization, ready-to-use 3D templates, AI product animation in 3D, combining Blender with AI video tools.',
         'REPLACE_WITH_VIDEO_URL_4', NULL, 4, 'basic', false, false, 299.00, NULL, true),

        (v_course_id, 'Wedding Cards & Sites',
         'AI wedding invite videos, event highlight reels, simple wedding websites & pages, client-ready templates you can resell.',
         'REPLACE_WITH_VIDEO_URL_5', NULL, 5, 'basic', false, false, 299.00, NULL, true),

        (v_course_id, 'AI Long-Form Movie Making',
         'Google Flow for long-form video, scene-to-scene consistency, advanced cinematic prompting, assembling a full AI short film.',
         'REPLACE_WITH_VIDEO_URL_6', NULL, 6, 'basic', false, false, 299.00, NULL, true),

        (v_course_id, 'Storyboard-Style AI + Manual Workflows — Professional Editing',
         'Planning with storyboards & visual roadmaps, mixing AI generation with manual editing, professional video editing essentials, polishing footage for client delivery.',
         'REPLACE_WITH_VIDEO_URL_7', NULL, 7, 'basic', false, false, 299.00, NULL, true),

        (v_course_id, 'Free API-Based Image & Video Generation Tools',
         'Using free APIs for image & video generation, walkthrough of the free web app, low-credit budget-friendly tool stack, staying current as free tools change.',
         'REPLACE_WITH_VIDEO_URL_8', NULL, 8, 'basic', false, false, 299.00, NULL, true);

    RAISE NOTICE 'AICreator course created with id %', v_course_id;
END $$;
