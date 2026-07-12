# LMS Platform - Complete Setup Guide

## Overview
This is a **complete** Learning Management System (LMS) with comprehensive features including:
- Tier-based access control (Basic/Premium)
- Course management with categories
- Video streaming via Mux
- Progress tracking & certificates
- Quizzes & assignments
- Discussion forums
- Announcements
- Reviews & ratings
- Notifications
- Mobile-responsive design

## Folder Structure
```
workspace/
├── index.html              # Main student dashboard
├── login.html              # User authentication page
├── admin.html              # Admin panel
├── admin-login.html        # Admin login page
├── lms.js                  # Core LMS functionality
├── lms-extensions.js       # Extended features (quizzes, assignments, etc.)
├── admin.js                # Admin panel functionality
├── api-routes.js           # API routes for Vercel/Prisma
├── lms.css                 # Dashboard styles
├── admin.css               # Admin panel styles
├── schema.sql              # Complete database schema
├── package.json            # Node.js dependencies
├── vercel.json             # Vercel deployment config
├── README.md               # This file
└── DEPLOYMENT.md           # Deployment instructions
```

## Database Schema

The complete LMS includes these tables:

### Core Tables
1. **profiles** - User accounts with subscription tiers
2. **courses** - Course catalog with pricing and categories
3. **course_categories** - Course organization
4. **course_modules** - Individual lessons within courses
5. **course_downloads** - Downloadable resources
6. **user_courses** - Tracks purchased courses
7. **course_enrollments** - Active enrollments with progress

### Assessment Tables
8. **quizzes** - Course quizzes
9. **quiz_questions** - Quiz questions with multiple types
10. **quiz_attempts** - User quiz attempts and scores
11. **assignments** - Homework/projects
12. **assignment_submissions** - Student submissions with grading

### Social & Communication Tables
13. **discussions** - Course discussion forums
14. **announcements** - Instructor announcements
15. **notifications** - User notifications system

### Achievement Tables
16. **course_reviews** - Student ratings and reviews
17. **certificates** - Course completion certificates
18. **user_progress** - Module completion tracking
19. **user_activity** - Activity logs for analytics

## Backend Options

### Option 1: Supabase (Recommended for Quick Setup)

1. **Create a Supabase Project**
   - Go to [supabase.com](https://supabase.com)
   - Create a new project
   - Get your project URL and anon key from Settings > API

2. **Run the Database Schema**
   ```sql
   -- In Supabase SQL Editor, run the entire schema.sql file
   -- This creates all tables, indexes, RLS policies, and triggers
   ```

3. **Update Configuration**
   
   In `login.html`, `index.html`, and `admin.html`:
   ```javascript
   const SUPABASE_URL = 'https://your-project.supabase.co';
   const SUPABASE_ANON_KEY = 'your-anon-key';
   ```

4. **Enable Authentication**
   - Go to Authentication > Providers
   - Enable Email/Password
   - Optionally enable Google OAuth

### Option 2: Prisma + Vercel (For Custom API)

1. **Initialize Prisma**
   ```bash
   npm init -y
   npm install prisma @prisma/client
   npx prisma init
   ```

2. **Setup Prisma Schema**
   - Copy the Prisma schema from `schema.sql` comments into `prisma/schema.prisma`
   - Update your `.env` file with database URL

3. **Deploy to Vercel**
   ```bash
   npm install vercel
   npx vercel
   ```

4. **Create API Routes**
   Use the provided `api-routes.js` as a starting point for:
   - `/api/courses` - GET all courses
   - `/api/modules?courseId=` - GET modules for a course
   - `/api/quizzes` - GET/POST quizzes
   - `/api/assignments` - GET/POST assignments
   - `/api/progress` - GET/POST user progress
   - `/api/certificates` - GET certificates
   - And more...

## Features Breakdown

### Student Features
- ✅ Email/Google authentication
- ✅ Tier-based access (Basic/Premium)
- ✅ Course browsing with categories
- ✅ Course purchase flow
- ✅ Video streaming with Mux player
- ✅ Module-by-module progress tracking
- ✅ Downloadable resources
- ✅ **NEW:** Take quizzes with auto-grading
- ✅ **NEW:** Submit assignments
- ✅ **NEW:** Participate in discussions
- ✅ **NEW:** View announcements
- ✅ **NEW:** Earn certificates on completion
- ✅ **NEW:** Write course reviews
- ✅ **NEW:** Receive notifications
- ✅ Activity history
- ✅ Mobile-responsive design

### Admin/Instructor Features
- ✅ Email-based admin authentication
- ✅ Course CRUD operations
- ✅ Module management
- ✅ **NEW:** Create quizzes with multiple question types
- ✅ **NEW:** Create and grade assignments
- ✅ **NEW:** Post announcements
- ✅ **NEW:** Moderate discussions
- ✅ **NEW:** Issue certificates
- ✅ User management
- ✅ Analytics dashboard
- ✅ Category management

## Usage Guide

### For Students

1. **Sign Up / Login**
   - Visit `login.html`
   - Create account or sign in with Google

2. **Browse Courses**
   - View available courses on dashboard
   - Filter by category
   - Check tier requirements

3. **Purchase & Learn**
   - Purchase courses based on your tier
   - Watch video modules
   - Track your progress
   - Download resources

4. **Assessments**
   - Take quizzes (multiple choice, true/false, short answer, essay)
   - Submit assignments before due dates
   - View grades and feedback

5. **Community**
   - Participate in course discussions
   - Read announcements
   - Write reviews after completing courses

6. **Achievements**
   - Earn certificates upon course completion
   - View your certificate collection
   - Share credentials

### For Instructors/Admins

1. **Access Admin Panel**
   - Visit `admin-login.html`
   - Only authorized admin emails can access

2. **Manage Courses**
   - Create/edit/delete courses
   - Organize by categories
   - Set pricing and tier requirements

3. **Create Content**
   - Add video modules
   - Upload downloadable resources
   - Create quizzes with various question types
   - Set up assignments with due dates

4. **Engage Students**
   - Post announcements
   - Moderate discussions
   - Grade assignments
   - Issue certificates

5. **Monitor Progress**
   - View student enrollments
   - Track completion rates
   - Review quiz statistics
   - Analyze activity logs

## Customization

### Adding New Features
The modular architecture makes it easy to extend:
- Edit `lms-extensions.js` to add new features
- Update `schema.sql` for new database tables
- Add corresponding UI components in `index.html`

### Styling
- Edit `lms.css` for student dashboard
- Edit `admin.css` for admin panel
- CSS variables for easy theme customization

### Payment Integration
Currently uses mock payments. To integrate real payments:
1. Update `purchaseCourse()` in `lms.js`
2. Integrate Stripe/Razorpay/PayPal
3. Add webhook handling in API routes

### Video Provider
Uses Mux for video streaming. To change:
1. Update `loadVideoPlayer()` in `lms.js`
2. Replace with YouTube/Vimeo/Wistia player
3. Update video URL handling

## Deployment

### Static Hosting (Netlify/Vercel/GitHub Pages)

1. Push files to your repository
2. Configure hosting to serve from root directory
3. Update Supabase/API credentials
4. Deploy

### Environment Variables
For production, use environment variables:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
MUX_TOKEN_ID=your-mux-token-id
MUX_TOKEN_SECRET=your-mux-token-secret
ADMIN_EMAILS=admin@example.com,instructor@example.com
```

## Testing

1. **Create Test Accounts**
   - Student account via `login.html`
   - Admin account (add email to admin.js)

2. **Add Sample Data**
   - Run seed data from `schema.sql`
   - Or use admin panel to create courses

3. **Test Flows**
   - Student: Browse → Purchase → Learn → Quiz → Certificate
   - Admin: Create Course → Add Modules → Create Quiz → Grade

## Troubleshooting

### "Authentication Required" shows forever
- Check Supabase credentials in all HTML files
- Verify auth is enabled in Supabase
- Check browser console for errors

### Courses not loading
- Verify database tables exist (run schema.sql)
- Check RLS policies in Supabase
- Ensure courses have `is_active = true`

### Quizzes/Assignments not working
- Ensure extension script is loaded: `<script src="lms-extensions.js"></script>`
- Check that new tables exist in database
- Verify RLS policies for new tables

### Video not playing
- Check Mux playback ID format
- Verify Mux player script is loaded
- Check CORS settings

## API Reference

### Supabase Direct Access
```javascript
// Get courses with categories
const { data } = await supabase
  .from('courses')
  .select('*, course_categories(name, icon)')
  .eq('is_active', true);

// Submit quiz
const { data } = await supabase.rpc('calculate_quiz_score', {
  p_quiz_id: quizId,
  p_answers: answers
});

// Generate certificate
const { data } = await supabase
  .from('certificates')
  .insert({ user_id, course_id });
```

## Support

For issues or questions:
1. Check browser console for errors
2. Verify database connection
3. Review Supabase logs
4. Check network requests in DevTools
5. Ensure all schema migrations are applied

## License

This LMS is provided as-is for educational and commercial use.

## Credits

Built with:
- Supabase (Backend & Auth)
- Mux (Video Streaming)
- Vanilla JavaScript (No framework dependencies)
- Modern CSS (Flexbox, Grid, Variables)
