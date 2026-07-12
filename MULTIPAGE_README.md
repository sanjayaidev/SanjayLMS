# LMS Platform - Multi-Page Architecture with Vercel Deployment

## Overview

This Learning Management System (LMS) has been transformed into a complete multi-page application with proper routing, authentication validation, and Vercel compatibility.

## 📁 File Structure

```
/workspace/
├── index.html              # Dashboard/Home page
├── my-courses.html         # User's enrolled courses grid
├── course-detail.html      # Individual course detail page
├── video-view.html         # Video player with module navigation
├── login.html              # Authentication page
├── admin.html              # Admin dashboard
├── router.js               # Client-side router with auth validation
├── lms.js                  # Core LMS functionality
├── lms-extensions.js       # Extended features (quizzes, assignments, etc.)
├── lms.css                 # Main styles
├── vercel.json             # Vercel deployment configuration
└── schema.sql              # Database schema for Supabase
```

## 🛣️ Routes

| Route | Page | Description |
|-------|------|-------------|
| `/` | `index.html` | Dashboard with all available courses |
| `/my-courses` | `my-courses.html` | User's purchased/enrolled courses |
| `/course/:id` | `course-detail.html` | Course details with modules list |
| `/video/:courseId/:moduleId` | `video-view.html` | Video player with navigation |
| `/login` | `login.html` | User authentication |
| `/admin` | `admin.html` | Admin panel |

## 🔐 Authentication Flow

1. **Protected Routes**: All routes except `/login` require authentication
2. **Auto-Redirect**: Unauthenticated users are redirected to login page
3. **Session Persistence**: Uses Supabase Auth session management
4. **Row Level Security**: Database-level access control via Supabase RLS

## 🚀 Vercel Deployment

### Prerequisites
- Vercel account
- Supabase project (or other backend)

### Deployment Steps

1. **Connect Repository to Vercel**
   ```bash
   # Install Vercel CLI (optional)
   npm i -g vercel
   
   # Deploy
   vercel
   ```

2. **Configure Environment Variables** (if needed)
   - Set Supabase URL and keys in your code or use Vercel environment variables

3. **Automatic Routing**
   - The `vercel.json` file configures clean URLs
   - Example: `/my-courses` serves `my-courses.html`

### vercel.json Configuration

The routing configuration includes:
- Static file serving for HTML, CSS, JS
- Custom route mappings for clean URLs
- Security headers (XSS protection, clickjacking prevention)

## 🎯 Key Features

### 1. My Courses Page (`/my-courses`)
- Grid view of all enrolled courses
- Search and filter by tier
- Sort by: Recent, Progress, Alphabetical
- Progress indicators per course
- Quick access to continue learning

### 2. Course Detail Page (`/course/:id`)
- Course hero section with metadata
- Complete modules list with status
- Downloadable resources section
- Tier-based access control
- Progress tracking display

### 3. Video View Page (`/video/:courseId/:moduleId`)
- Full-screen Mux video player
- Module navigation sidebar
- Previous/Next navigation
- Mark as complete functionality
- Real-time progress updates
- Activity tracking

### 4. Router System (`router.js`)
- Client-side routing with history API
- Authentication validation on route change
- Parameter parsing for dynamic routes
- Programmatic navigation helpers
- Browser back/forward support

## 🔧 Usage Examples

### Navigation in JavaScript
```javascript
// Navigate to My Courses
window.lmsRouter.goToMyCourses();

// Navigate to specific course
window.lmsRouter.goToCourse('course-id-here');

// Navigate to specific video
window.lmsRouter.goToVideo('course-id', 'module-id');

// Go back
window.lmsRouter.goBack();

// Navigate to home
window.lmsRouter.goToHome();
```

### Accessing Route Parameters
```javascript
// In course-detail.html
const courseId = window.lmsRouter.currentParams.courseId;

// In video-view.html
const { courseId, moduleId } = window.lmsRouter.currentParams;
```

### Listening to Route Changes
```javascript
window.addEventListener('routeChanged', (e) => {
    console.log('New route:', e.detail.path);
    console.log('Parameters:', e.detail.params);
});
```

## 🗄️ Database Requirements

Ensure your Supabase database has these tables:

### Core Tables
- `profiles` - User profiles with subscription tiers
- `courses` - Course catalog
- `course_modules` - Video modules per course
- `course_downloads` - Downloadable resources
- `user_courses` - User enrollments/purchases
- `user_progress` - Module completion tracking
- `user_activity` - Activity logging

### Run Schema
```bash
# Execute schema.sql in your Supabase SQL editor
# Or via CLI:
psql -h db.xxx.supabase.co -U postgres -d postgres -f schema.sql
```

## 🎨 Styling

All pages use:
- `lms.css` - Base styles and components
- Inline styles for page-specific layouts
- Responsive design (mobile-friendly)
- Consistent header/navigation across pages

## 🔒 Security Features

1. **Authentication Checks**: Every protected page validates session
2. **Access Control**: Tier-based content restrictions
3. **RLS Policies**: Database-level security via Supabase
4. **Security Headers**: XSS, clickjacking, MIME sniffing protection

## 📱 Mobile Support

- Responsive layouts on all pages
- Touch-friendly navigation
- Adaptive video player
- Mobile menu system

## 🚦 Getting Started

1. **Clone/Download** the project
2. **Update** Supabase credentials in each HTML file:
   ```javascript
   window.LMS_CONFIG = {
       SUPABASE_URL: 'your-url',
       SUPABASE_ANON_KEY: 'your-key'
   };
   ```
3. **Run** schema.sql in Supabase
4. **Deploy** to Vercel:
   ```bash
   vercel --prod
   ```
5. **Test** authentication and navigation

## 🐛 Troubleshooting

### Routes not working on Vercel
- Ensure `vercel.json` is in the root directory
- Check build logs for routing errors
- Verify file names match route destinations

### Authentication issues
- Verify Supabase credentials are correct
- Check RLS policies in Supabase dashboard
- Ensure `profiles` table exists and is populated

### Video not loading
- Check Mux playback IDs in database
- Verify Mux integration is configured
- Check browser console for errors

## 📝 Next Steps

- Add quiz/assessment pages
- Implement discussion forums
- Add certificate generation page
- Create user profile page
- Add payment integration pages

---

**Built with**: Supabase, Mux, Vanilla JS, Vercel
**License**: MIT
