# LMS Platform - Setup Guide

## Overview
This is a complete Learning Management System (LMS) with tier-based access control, progress tracking, and video streaming capabilities.

## Folder Structure
```
Learn/
├── index.html          # Main dashboard
├── login.html          # User authentication page
├── admin.html          # Admin panel (requires admin email)
├── admin-login.html    # Admin login page
├── lms.js              # Core LMS functionality
├── admin.js            # Admin panel functionality
├── lms.css             # Dashboard styles
├── admin.css           # Admin panel styles
├── schema.sql          # Database schema for PostgreSQL
└── README.md           # This file
```

## Backend Options

### Option 1: Supabase (Recommended for Quick Setup)

1. **Create a Supabase Project**
   - Go to [supabase.com](https://supabase.com)
   - Create a new project
   - Get your project URL and anon key from Settings > API

2. **Run the Database Schema**
   ```bash
   # In Supabase SQL Editor, run:
   # Copy contents of schema.sql and execute
   ```

3. **Update Configuration**
   
   In `login.html`:
   ```javascript
   const SUPABASE_URL = 'https://your-project.supabase.co';
   const SUPABASE_ANON_KEY = 'your-anon-key';
   ```

   In `lms.js` (update the initialization section):
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
   Create API endpoints in `api/` folder:
   - `/api/courses` - GET all courses
   - `/api/modules?courseId=` - GET modules for a course
   - `/api/progress` - GET/POST user progress
   - `/api/user-courses` - GET/POST user course purchases
   - `/api/activity` - GET user activity

5. **Update Frontend Configuration**
   In `index.html`:
   ```javascript
   window.LMS_CONFIG = {
       API_BASE_URL: 'https://your-vercel-app.vercel.app/api',
       USE_PRISMA_API: true
   };
   ```

## Database Tables

The system uses these tables:

1. **profiles** - User accounts with subscription tiers (basic/premium)
2. **courses** - Course catalog with pricing and tier requirements
3. **course_modules** - Individual lessons within courses
4. **course_downloads** - Downloadable resources
5. **user_courses** - Tracks purchased courses
6. **user_progress** - Tracks module completion
7. **user_activity** - Activity logs for analytics

## Features

### User Features
- ✅ Email/Google authentication
- ✅ Tier-based access (Basic/Premium)
- ✅ Course browsing and purchase
- ✅ Video streaming with Mux
- ✅ Progress tracking
- ✅ Downloadable resources
- ✅ Activity history
- ✅ Mobile-responsive design

### Admin Features
- ✅ Email-based admin authentication (configured in `admin.js`)
- ✅ Course management
- ✅ Module management
- ✅ User management
- ✅ Analytics dashboard

**Admin Access:** By default, only `graphicyin@gmail.com` has admin access. To add more admins, edit the `adminEmails` array in `admin.js` line 51 and `admin-login.html`.

## Customization

### Changing Video Provider
The system uses Mux for video streaming. To change:

1. Update `loadVideoPlayer()` in `lms.js`
2. Replace Mux player with your preferred video player
3. Update video URL handling

### Adding Payment Gateway
Currently uses mock payments. To integrate real payments:

1. Update `purchaseCourse()` in `lms.js`
2. Integrate Stripe/Razorpay/PayPal
3. Add webhook handling for payment confirmation

### Styling
- Edit `lms.css` for dashboard styles
- Edit `admin.css` for admin panel
- Colors and branding can be customized via CSS variables

## Deployment

### Static Hosting (Netlify/Vercel/GitHub Pages)

1. Push the `Learn/` folder to your repository
2. Configure hosting to serve from `Learn/` directory
3. Update Supabase/API credentials
4. Deploy

### Environment Variables
For production, use environment variables:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
MUX_TOKEN_ID=your-mux-token-id
MUX_TOKEN_SECRET=your-mux-token-secret
```

## Testing

1. Create a test account via `login.html`
2. Manually add courses in database or via admin panel
3. Test course purchase flow
4. Test video playback
5. Test progress tracking

## Troubleshooting

### "Authentication Required" shows forever
- Check Supabase credentials
- Verify auth is enabled in Supabase
- Check browser console for errors

### Courses not loading
- Verify database tables exist
- Check RLS policies in Supabase
- Ensure courses have `is_active = true`

### Video not playing
- Check Mux playback ID format
- Verify Mux player script is loaded
- Check CORS settings

## Support

For issues or questions:
1. Check browser console for errors
2. Verify database connection
3. Review Supabase logs
4. Check network requests in DevTools

## License

This LMS is provided as-is for educational and commercial use.
