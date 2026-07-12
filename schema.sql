-- LMS Database Schema for PostgreSQL (Supabase/Prisma/Vercel)
-- This schema supports a Learning Management System with tier-based access control

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- PROFILES TABLE - User profiles with subscription tiers
-- ============================================
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255),
    avatar_url TEXT,
    subscription_tier VARCHAR(50) DEFAULT 'basic' CHECK (subscription_tier IN ('basic', 'premium')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_profiles_subscription_tier ON profiles(subscription_tier);

-- ============================================
-- COURSES TABLE - Course catalog
-- ============================================
CREATE TABLE IF NOT EXISTS courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    thumbnail_url TEXT,
    price DECIMAL(10, 2) DEFAULT 0.00,
    required_tier VARCHAR(50) DEFAULT 'basic' CHECK (required_tier IN ('basic', 'premium')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for active courses
CREATE INDEX IF NOT EXISTS idx_courses_is_active ON courses(is_active);
CREATE INDEX IF NOT EXISTS idx_courses_required_tier ON courses(required_tier);

-- ============================================
-- COURSE MODULES TABLE - Individual lessons/modules within courses
-- ============================================
CREATE TABLE IF NOT EXISTS course_modules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    video_url TEXT,
    duration VARCHAR(50),
    module_order INTEGER NOT NULL DEFAULT 0,
    required_tier VARCHAR(50) DEFAULT 'basic' CHECK (required_tier IN ('basic', 'premium')),
    is_premium BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for ordering modules within courses
CREATE INDEX IF NOT EXISTS idx_course_modules_course_id ON course_modules(course_id);
CREATE INDEX IF NOT EXISTS idx_course_modules_module_order ON course_modules(course_id, module_order);

-- ============================================
-- COURSE DOWNLOADS TABLE - Downloadable resources for courses
-- ============================================
CREATE TABLE IF NOT EXISTS course_downloads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    file_url TEXT NOT NULL,
    file_size VARCHAR(50),
    file_type VARCHAR(50),
    is_premium BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for course downloads
CREATE INDEX IF NOT EXISTS idx_course_downloads_course_id ON course_downloads(course_id);

-- ============================================
-- USER COURSES TABLE - Tracks which courses users have purchased
-- ============================================
CREATE TABLE IF NOT EXISTS user_courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    payment_status VARCHAR(50) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'completed', 'failed', 'refunded')),
    purchased_price DECIMAL(10, 2),
    purchased_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, course_id)
);

-- Index for user's courses
CREATE INDEX IF NOT EXISTS idx_user_courses_user_id ON user_courses(user_id);
CREATE INDEX IF NOT EXISTS idx_user_courses_course_id ON user_courses(course_id);
CREATE INDEX IF NOT EXISTS idx_user_courses_payment_status ON user_courses(payment_status);

-- ============================================
-- USER PROGRESS TABLE - Tracks user progress through modules
-- ============================================
CREATE TABLE IF NOT EXISTS user_progress (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    module_id UUID NOT NULL REFERENCES course_modules(id) ON DELETE CASCADE,
    course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
    completed BOOLEAN DEFAULT false,
    progress_percentage INTEGER DEFAULT 0 CHECK (progress_percentage >= 0 AND progress_percentage <= 100),
    last_accessed TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, module_id)
);

-- Index for user progress tracking
CREATE INDEX IF NOT EXISTS idx_user_progress_user_id ON user_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_user_progress_module_id ON user_progress(module_id);
CREATE INDEX IF NOT EXISTS idx_user_progress_completed ON user_progress(completed);

-- ============================================
-- USER ACTIVITY TABLE - Logs user activities for analytics
-- ============================================
CREATE TABLE IF NOT EXISTS user_activity (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    activity_type VARCHAR(50) NOT NULL CHECK (activity_type IN ('module_access', 'module_complete', 'course_purchase', 'tier_upgrade', 'download', 'login', 'logout')),
    course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
    module_id UUID REFERENCES course_modules(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for activity queries
CREATE INDEX IF NOT EXISTS idx_user_activity_user_id ON user_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_activity_type ON user_activity(activity_type);
CREATE INDEX IF NOT EXISTS idx_user_activity_created_at ON user_activity(created_at DESC);

-- ============================================
-- ROW LEVEL SECURITY (RLS) POLICIES FOR SUPABASE
-- ============================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_downloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_activity ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view their own profile"
    ON profiles FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
    ON profiles FOR UPDATE
    USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles"
    ON profiles FOR SELECT
    USING (
        auth.uid() = id OR
        COALESCE(auth.jwt() ->> 'email', '') = 'graphicyin@gmail.com'
    );

-- Courses policies (public read for active courses)
CREATE POLICY "Anyone can view active courses"
    ON courses FOR SELECT
    USING (is_active = true);

-- Course modules policies
CREATE POLICY "Anyone can view active modules from active courses"
    ON course_modules FOR SELECT
    USING (
        is_active = true AND
        EXISTS (SELECT 1 FROM courses WHERE id = course_modules.course_id AND is_active = true)
    );

-- Course downloads policies
CREATE POLICY "Anyone can view downloads from active courses"
    ON course_downloads FOR SELECT
    USING (
        EXISTS (SELECT 1 FROM courses WHERE id = course_downloads.course_id AND is_active = true)
    );

-- User courses policies
CREATE POLICY "Users can view their own course purchases"
    ON user_courses FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own course purchases"
    ON user_courses FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- User progress policies
CREATE POLICY "Users can view their own progress"
    ON user_progress FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert/update their own progress"
    ON user_progress FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- User activity policies
CREATE POLICY "Users can view their own activity"
    ON user_activity FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own activity"
    ON user_activity FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- ============================================
-- TRIGGERS FOR AUTOMATIC TIMESTAMP UPDATES
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to profiles table
CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to courses table
CREATE TRIGGER update_courses_updated_at
    BEFORE UPDATE ON courses
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to course_modules table
CREATE TRIGGER update_course_modules_updated_at
    BEFORE UPDATE ON course_modules
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to user_progress table
CREATE TRIGGER update_user_progress_updated_at
    BEFORE UPDATE ON user_progress
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- SEED DATA (OPTIONAL - FOR TESTING)
-- ============================================

-- Example: Insert a sample course
-- INSERT INTO courses (title, description, price, required_tier, is_active)
-- VALUES (
--     'Introduction to Web Development',
--     'Learn the basics of HTML, CSS, and JavaScript',
--     29.99,
--     'basic',
--     true
-- );

-- Example: Insert sample modules
-- INSERT INTO course_modules (course_id, title, description, video_url, duration, module_order, required_tier, is_premium)
-- VALUES 
--     ((SELECT id FROM courses WHERE title = 'Introduction to Web Development'), 
--      'Getting Started with HTML', 
--      'Learn the fundamentals of HTML structure',
--      'https://example.com/video1.m3u8',
--      '15:30',
--      1,
--      'basic',
--      false),
--     ((SELECT id FROM courses WHERE title = 'Introduction to Web Development'), 
--      'CSS Styling Basics', 
--      'Master CSS selectors and properties',
--      'https://example.com/video2.m3u8',
--      '20:45',
--      2,
--      'basic',
--      false);

-- ============================================
-- USEFUL QUERIES FOR API ENDPOINTS
-- ============================================

-- Query: Get all active courses for a user based on their tier
-- SELECT c.* FROM courses c
-- WHERE c.is_active = true
-- ORDER BY c.created_at;

-- Query: Get user's purchased courses
-- SELECT uc.*, c.title, c.description, c.thumbnail_url
-- FROM user_courses uc
-- JOIN courses c ON uc.course_id = c.id
-- WHERE uc.user_id = 'USER_UUID' AND uc.payment_status = 'completed';

-- Query: Get modules for a specific course
-- SELECT * FROM course_modules
-- WHERE course_id = 'COURSE_UUID' AND is_active = true
-- ORDER BY module_order;

-- Query: Get user's progress for a course
-- SELECT cm.id as module_id, cm.title, cm.module_order, 
--        COALESCE(up.completed, false) as completed,
--        COALESCE(up.progress_percentage, 0) as progress_percentage
-- FROM course_modules cm
-- LEFT JOIN user_progress up ON cm.id = up.module_id AND up.user_id = 'USER_UUID'
-- WHERE cm.course_id = 'COURSE_UUID'
-- ORDER BY cm.module_order;

-- Query: Get overall user progress statistics
-- SELECT 
--     COUNT(DISTINCT up.module_id) as total_modules_accessed,
--     COUNT(DISTINCT CASE WHEN up.completed THEN up.module_id END) as completed_modules,
--     ROUND(COUNT(DISTINCT CASE WHEN up.completed THEN up.module_id END) * 100.0 / 
--           NULLIF(COUNT(DISTINCT up.module_id), 0), 2) as completion_percentage
-- FROM user_progress up
-- WHERE up.user_id = 'USER_UUID';

-- Query: Get user's recent activity
-- SELECT * FROM user_activity
-- WHERE user_id = 'USER_UUID'
-- ORDER BY created_at DESC
-- LIMIT 10;

-- ============================================
-- PRISMA SCHEMA (Alternative for Prisma ORM)
-- ============================================
-- If using Prisma, create a schema.prisma file with:
/*
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Profile {
  id                String    @id @default(uuid())
  email             String    @unique
  full_name         String?
  avatar_url        String?
  subscription_tier String    @default("basic")
  created_at        DateTime  @default(now())
  updated_at        DateTime  @updatedAt
  userCourses       UserCourse[]
  userProgress      UserProgress[]
  userActivity      UserActivity[]

  @@map("profiles")
}

model Course {
  id            String   @id @default(uuid())
  title         String
  description   String?
  thumbnail_url String?
  price         Decimal  @default(0)
  required_tier String   @default("basic")
  is_active     Boolean  @default(true)
  created_at    DateTime @default(now())
  updated_at    DateTime @updatedAt
  modules       CourseModule[]
  downloads     CourseDownload[]
  userCourses   UserCourse[]

  @@map("courses")
}

model CourseModule {
  id            String   @id @default(uuid())
  course_id     String
  title         String
  description   String?
  video_url     String?
  duration      String?
  module_order  Int      @default(0)
  required_tier String   @default("basic")
  is_premium    Boolean  @default(false)
  is_active     Boolean  @default(true)
  created_at    DateTime @default(now())
  updated_at    DateTime @updatedAt
  course        Course   @relation(fields: [course_id], references: [id], onDelete: Cascade)
  userProgress  UserProgress[]

  @@index([course_id])
  @@index([course_id, module_order])
  @@map("course_modules")
}

model CourseDownload {
  id          String   @id @default(uuid())
  course_id   String
  title       String
  description String?
  file_url    String
  file_size   String?
  file_type   String?
  is_premium  Boolean  @default(false)
  created_at  DateTime @default(now())
  course      Course   @relation(fields: [course_id], references: [id], onDelete: Cascade)

  @@index([course_id])
  @@map("course_downloads")
}

model UserCourse {
  id             String   @id @default(uuid())
  user_id        String
  course_id      String
  payment_status String   @default("pending")
  purchased_price Decimal?
  purchased_at   DateTime @default(now())
  created_at     DateTime @default(now())
  user           Profile  @relation(fields: [user_id], references: [id], onDelete: Cascade)
  course         Course   @relation(fields: [course_id], references: [id], onDelete: Cascade)

  @@unique([user_id, course_id])
  @@index([user_id])
  @@index([course_id])
  @@map("user_courses")
}

model UserProgress {
  id                 String    @id @default(uuid())
  user_id            String
  module_id          String
  course_id          String?
  completed          Boolean   @default(false)
  progress_percentage Int       @default(0)
  last_accessed      DateTime  @default(now())
  completed_at       DateTime?
  created_at         DateTime  @default(now())
  updated_at         DateTime  @updatedAt
  user               Profile    @relation(fields: [user_id], references: [id], onDelete: Cascade)
  module             CourseModule @relation(fields: [module_id], references: [id], onDelete: Cascade)

  @@unique([user_id, module_id])
  @@index([user_id])
  @@index([module_id])
  @@map("user_progress")
}

model UserActivity {
  id            String   @id @default(uuid())
  user_id       String
  activity_type String
  course_id     String?
  module_id     String?
  metadata      Json     @default("{}")
  created_at    DateTime @default(now())
  user          Profile  @relation(fields: [user_id], references: [id], onDelete: Cascade)

  @@index([user_id])
  @@index([activity_type])
  @@index([created_at(sort: Desc)])
  @@map("user_activity")
}
*/
