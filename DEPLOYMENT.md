# LMS Platform - Vercel Deployment Guide

## Quick Deploy to Vercel

### Option 1: Deploy via Vercel CLI (Recommended)

1. **Install Vercel CLI** (if not already installed):
   ```bash
   npm install -g vercel
   ```

2. **Login to Vercel**:
   ```bash
   vercel login
   ```

3. **Deploy**:
   ```bash
   vercel
   ```

4. **Production Deployment**:
   ```bash
   vercel --prod
   ```

### Option 2: Deploy via GitHub Integration

1. **Push your code to GitHub**:
   ```bash
   git add .
   git commit -m "Initial commit"
   git push origin main
   ```

2. **Connect to Vercel**:
   - Go to [vercel.com](https://vercel.com)
   - Click "New Project"
   - Import your GitHub repository
   - Click "Deploy"

## Configuration Files

This project includes the following configuration files for Vercel:

- `vercel.json` - Vercel deployment configuration
- `package.json` - Node.js package configuration

## Environment Variables

If you need to configure environment variables for Supabase or other services:

1. Go to your project in Vercel Dashboard
2. Navigate to Settings > Environment Variables
3. Add your variables:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`

## Local Development

```bash
npm install
npm run dev
```

Then open http://localhost:3000 in your browser.

## Features

- ✅ Static HTML/CSS/JS site
- ✅ Supabase integration for authentication and database
- ✅ Responsive design
- ✅ Mobile-friendly navigation
- ✅ Course management with tier-based access
- ✅ Video streaming support (Mux)
- ✅ Progress tracking

## Troubleshooting

### CSS Not Loading
- Ensure all CSS files are in the root directory
- Check that file paths in HTML are correct (relative paths)

### Authentication Issues
- Verify Supabase URL and anon key in `index.html` and `login.html`
- Check that database schema is properly set up in Supabase

### API Routes
- The `api-routes.js` file is configured for serverless function deployment
- Update routes in `vercel.json` if needed

## Support

For issues or questions, please refer to the README.md file or contact support.
