// API Routes for LMS Platform - Vercel/Node.js
// Use these routes if you're deploying with Prisma instead of Supabase

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ============================================
// COURSES API
// ============================================

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const courseId = searchParams.get('courseId');
  
  try {
    if (courseId) {
      // Get single course with modules
      const course = await prisma.course.findUnique({
        where: { id: courseId },
        include: {
          modules: {
            where: { is_active: true },
            orderBy: { module_order: 'asc' }
          },
          downloads: true
        }
      });
      
      if (!course) {
        return new Response(JSON.stringify({ error: 'Course not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      return new Response(JSON.stringify(course), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      // Get all active courses
      const courses = await prisma.course.findMany({
        where: { is_active: true },
        orderBy: { created_at: 'asc' }
      });
      
      return new Response(JSON.stringify(courses), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } catch (error) {
    console.error('Error fetching courses:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch courses' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ============================================
// USER COURSES API
// ============================================

export async function POST(request) {
  const body = await request.json();
  const { userId, courseId, paymentStatus = 'completed', purchasedPrice } = body;
  
  try {
    const userCourse = await prisma.userCourse.upsert({
      where: {
        userId_courseId: {
          user_id: userId,
          course_id: courseId
        }
      },
      update: {
        payment_status: paymentStatus,
        purchased_price: purchasedPrice
      },
      create: {
        user_id: userId,
        course_id: courseId,
        payment_status: paymentStatus,
        purchased_price: purchasedPrice
      }
    });
    
    return new Response(JSON.stringify(userCourse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error creating user course:', error);
    return new Response(JSON.stringify({ error: 'Failed to purchase course' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ============================================
// USER PROGRESS API
// ============================================

export async function getProgress(userId, moduleId) {
  try {
    const progress = await prisma.userProgress.findUnique({
      where: {
        userId_moduleId: {
          user_id: userId,
          module_id: moduleId
        }
      }
    });
    
    return new Response(JSON.stringify(progress || { completed: false, progress_percentage: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error fetching progress:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch progress' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function updateProgress(request) {
  const body = await request.json();
  const { userId, moduleId, courseId, completed, progressPercentage } = body;
  
  try {
    const progress = await prisma.userProgress.upsert({
      where: {
        userId_moduleId: {
          user_id: userId,
          module_id: moduleId
        }
      },
      update: {
        completed: completed,
        progress_percentage: progressPercentage,
        last_accessed: new Date(),
        completed_at: completed ? new Date() : null
      },
      create: {
        user_id: userId,
        module_id: moduleId,
        course_id: courseId,
        completed: completed || false,
        progress_percentage: progressPercentage || 0,
        last_accessed: new Date()
      }
    });
    
    return new Response(JSON.stringify(progress), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error updating progress:', error);
    return new Response(JSON.stringify({ error: 'Failed to update progress' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ============================================
// USER ACTIVITY API
// ============================================

export async function logActivity(request) {
  const body = await request.json();
  const { userId, activityType, courseId, moduleId, metadata = {} } = body;
  
  try {
    const activity = await prisma.userActivity.create({
      data: {
        user_id: userId,
        activity_type: activityType,
        course_id: courseId,
        module_id: moduleId,
        metadata: metadata
      }
    });
    
    return new Response(JSON.stringify(activity), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error logging activity:', error);
    return new Response(JSON.stringify({ error: 'Failed to log activity' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function getUserActivity(userId, limit = 10) {
  try {
    const activities = await prisma.userActivity.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: limit
    });
    
    return new Response(JSON.stringify(activities), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error fetching activity:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch activity' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ============================================
// PROFILE API
// ============================================

export async function getProfile(userId) {
  try {
    const profile = await prisma.profile.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        full_name: true,
        avatar_url: true,
        subscription_tier: true
      }
    });
    
    if (!profile) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify(profile), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error fetching profile:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch profile' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function updateProfile(request) {
  const body = await request.json();
  const { userId, fullName, avatarUrl, subscriptionTier } = body;
  
  try {
    const profile = await prisma.profile.update({
      where: { id: userId },
      data: {
        full_name: fullName,
        avatar_url: avatarUrl,
        subscription_tier: subscriptionTier
      }
    });
    
    return new Response(JSON.stringify(profile), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    return new Response(JSON.stringify({ error: 'Failed to update profile' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ============================================
// EXAMPLE VERCEL API ROUTE HANDLER
// ============================================
// Save this as api/lms/[endpoint].js in your Vercel project

/*
export default async function handler(req, res) {
  const { endpoint } = req.query;
  
  switch(endpoint) {
    case 'courses':
      if (req.method === 'GET') {
        const response = await GET(req);
        const data = await response.json();
        res.status(response.status).json(data);
      }
      break;
      
    case 'user-courses':
      if (req.method === 'POST') {
        const response = await POST(req);
        const data = await response.json();
        res.status(response.status).json(data);
      }
      break;
      
    case 'progress':
      if (req.method === 'GET') {
        const { userId, moduleId } = req.query;
        const response = await getProgress(userId, moduleId);
        const data = await response.json();
        res.status(response.status).json(data);
      } else if (req.method === 'POST') {
        const response = await updateProgress(req);
        const data = await response.json();
        res.status(response.status).json(data);
      }
      break;
      
    case 'activity':
      if (req.method === 'POST') {
        const response = await logActivity(req);
        const data = await response.json();
        res.status(response.status).json(data);
      } else if (req.method === 'GET') {
        const { userId, limit } = req.query;
        const response = await getUserActivity(userId, limit);
        const data = await response.json();
        res.status(response.status).json(data);
      }
      break;
      
    case 'profile':
      if (req.method === 'GET') {
        const { userId } = req.query;
        const response = await getProfile(userId);
        const data = await response.json();
        res.status(response.status).json(data);
      } else if (req.method === 'PUT') {
        const response = await updateProfile(req);
        const data = await response.json();
        res.status(response.status).json(data);
      }
      break;
      
    default:
      res.status(404).json({ error: 'Endpoint not found' });
  }
}
*/
