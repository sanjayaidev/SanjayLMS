// Enhanced LMS Manager with Progress Tracking and Tier-based Access
class LMSManager {
    constructor() {
        this.currentUser = null;
        this.userProfile = null;
        this.courses = [];
        this.userCourses = [];
        this.modules = [];
        this.downloads = [];
        this.userProgress = {};
        this.currentCourse = null;
        this.currentModule = null;
        this.userActivity = [];
        this.init();
    }

    async init() {
        await this.checkAuthState();
        this.setupEventListeners();
    }

    async checkAuthState() {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        const authRequired = document.getElementById('authRequired');
        const dashboard = document.getElementById('dashboard');
        const progressSection = document.getElementById('progress');
        const userEmail = document.getElementById('userEmail');
        const displayEmail = document.getElementById('displayEmail');
        const mobileUserEmail = document.getElementById('mobileUserEmail');

        if (session && session.user) {
            this.currentUser = session.user;
            authRequired.style.display = 'none';
            dashboard.style.display = 'block';
            progressSection.style.display = 'block';
            
            userEmail.textContent = session.user.email;
            displayEmail.textContent = session.user.email;
            mobileUserEmail.textContent = session.user.email;
            
            await this.loadUserData();
            await this.loadCourses();
            await this.loadUserCourses();
            await this.loadUserProgress();
            await this.loadUserActivity();
            
            this.renderCourses();
            this.updateProgress();
            this.checkUpgradePrompt();
            
        } else {
            authRequired.style.display = 'block';
            dashboard.style.display = 'none';
            progressSection.style.display = 'none';
        }
    }

    async loadUserData() {
        if (!this.currentUser) return;

        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', this.currentUser.id)
                .single();

            if (error) throw error;
            this.userProfile = data;
            
            // Update UI with user tier
            const tier = this.userProfile.subscription_tier || 'basic';
            document.getElementById('currentTier').textContent = tier;
            document.getElementById('displayTier').textContent = tier;
            document.getElementById('mobileUserTier').textContent = tier;
            
        } catch (error) {
            console.error('Error loading user profile:', error);
        }
    }

    async loadCourses() {
        try {
            const { data, error } = await supabase
                .from('courses')
                .select('*')
                .eq('is_active', true)
                .order('created_at');

            if (error) throw error;
            this.courses = data || [];
        } catch (error) {
            console.error('Error loading courses:', error);
            this.courses = [];
        }
    }

    async loadUserCourses() {
        if (!this.currentUser) return;

        try {
            const { data, error } = await supabase
                .from('user_courses')
                .select('*')
                .eq('user_id', this.currentUser.id)
                .eq('payment_status', 'completed');

            if (error) throw error;
            this.userCourses = data || [];
            
            document.getElementById('purchasedCount').textContent = this.userCourses.length;
            
        } catch (error) {
            console.error('Error loading user courses:', error);
            this.userCourses = [];
        }
    }

    async loadUserProgress() {
        if (!this.currentUser) return;

        try {
            const { data, error } = await supabase
                .from('user_progress')
                .select('*')
                .eq('user_id', this.currentUser.id);

            if (error) throw error;
            
            // Convert to a more usable format
            this.userProgress = {};
            data?.forEach(progress => {
                this.userProgress[progress.module_id] = progress;
            });

            // Update completed count
            const completedCount = Object.values(this.userProgress).filter(p => p.completed).length;
            document.getElementById('completedCount').textContent = completedCount;
            
        } catch (error) {
            console.error('Error loading user progress:', error);
            this.userProgress = {};
        }
    }

    async loadUserActivity() {
        if (!this.currentUser) return;

        try {
            const { data, error } = await supabase
                .from('user_activity')
                .select('*')
                .eq('user_id', this.currentUser.id)
                .order('created_at', { ascending: false })
                .limit(10);

            if (error) throw error;
            this.userActivity = data || [];
            this.renderUserActivity();
            
        } catch (error) {
            console.error('Error loading user activity:', error);
            this.userActivity = [];
        }
    }

    async loadCourseModules(courseId) {
        try {
            const { data, error } = await supabase
                .from('course_modules')
                .select('*')
                .eq('course_id', courseId)
                .order('module_order');

            if (error) throw error;
            this.modules = data || [];
            
        } catch (error) {
            console.error('Error loading modules:', error);
            this.modules = [];
        }
    }

    async loadCourseDownloads(courseId) {
        try {
            const { data, error } = await supabase
                .from('course_downloads')
                .select('*')
                .eq('course_id', courseId)
                .order('created_at');

            if (error) throw error;
            this.downloads = data || [];
            
        } catch (error) {
            console.error('Error loading downloads:', error);
            this.downloads = [];
        }
    }

    setupEventListeners() {
        document.getElementById('logoutBtn').addEventListener('click', () => this.logout());
        document.getElementById('mobileLogoutBtn').addEventListener('click', () => this.logout());
        
        // Video controls
        document.getElementById('prevModule')?.addEventListener('click', () => this.previousModule());
        document.getElementById('nextModule')?.addEventListener('click', () => this.nextModule());
        document.getElementById('completeModule')?.addEventListener('click', () => this.markModuleComplete());
    }

    // TIER-BASED ACCESS CONTROL
    hasCourseAccess(courseId) {
        const course = this.courses.find(c => c.id === courseId);
        if (!course) return false;

        // Check if user has purchased the course
        const hasPurchased = this.userCourses.some(uc => uc.course_id === courseId);
        
        // Check if user's tier meets course requirement
        const tierLevel = { 'basic': 1, 'premium': 2 };
        const userTierLevel = tierLevel[this.userProfile?.subscription_tier] || 1;
        const courseTierLevel = tierLevel[course.required_tier] || 1;
        
        return hasPurchased && userTierLevel >= courseTierLevel;
    }

    hasModuleAccess(module) {
        const tierLevel = { 'basic': 1, 'premium': 2 };
        const userTierLevel = tierLevel[this.userProfile?.subscription_tier] || 1;
        const moduleTierLevel = tierLevel[module.required_tier] || 1;
        
        return userTierLevel >= moduleTierLevel && !(module.is_premium && this.userProfile?.subscription_tier !== 'premium');
    }

    hasDownloadAccess(download) {
        if (!download.is_premium) return true;
        return this.userProfile?.subscription_tier === 'premium';
    }

    checkUpgradePrompt() {
        const upgradeBanner = document.getElementById('upgradeBanner');
        if (this.userProfile?.subscription_tier === 'basic') {
            upgradeBanner.style.display = 'block';
        } else {
            upgradeBanner.style.display = 'none';
        }
    }

    // COURSE RENDERING
    renderCourses() {
        const container = document.getElementById('coursesContainer');
        if (!container) return;

        container.innerHTML = this.courses.map(course => {
            const hasAccess = this.hasCourseAccess(course.id);
            const canPurchase = this.canPurchaseCourse(course);
            const courseProgress = this.getCourseProgress(course.id);
            
            return `
                <div class="course-card ${hasAccess ? 'unlocked' : 'locked'}">
                    ${hasAccess ? '<div class="access-badge">✅ Access Granted</div>' : ''}
                    <h3>${course.title}</h3>
                    <p>${course.description}</p>
                    <div class="course-meta">
                        <span class="course-tier">${course.required_tier.toUpperCase()} TIER</span>
                        <span class="course-price">$${course.price}</span>
                        ${hasAccess ? `<span class="progress-badge">${courseProgress.percentage}% Complete</span>` : ''}
                    </div>
                    <div class="course-actions">
                        ${hasAccess ? 
                            `<button class="cta-button" onclick="lmsManager.viewCourse('${course.id}')">Continue Learning</button>` :
                            (canPurchase ?
                                `<button class="cta-button purchase" onclick="lmsManager.purchaseCourse('${course.id}')">Purchase - $${course.price}</button>` :
                                `<button class="cta-button disabled" disabled>Upgrade Tier Required</button>`
                            )
                        }
                    </div>
                </div>
            `;
        }).join('');
    }

    async viewCourse(courseId) {
        this.currentCourse = this.courses.find(c => c.id === courseId);
        if (!this.currentCourse) return;

        document.getElementById('coursesView').style.display = 'none';
        document.getElementById('courseDetailsView').style.display = 'block';

        document.getElementById('courseDetailTitle').textContent = this.currentCourse.title;
        document.getElementById('courseDetailDescription').textContent = this.currentCourse.description;
        document.getElementById('courseDetailTier').textContent = this.currentCourse.required_tier.toUpperCase() + ' TIER';
        document.getElementById('courseDetailPrice').textContent = '$' + this.currentCourse.price;

        const courseProgress = this.getCourseProgress(courseId);
        document.getElementById('courseProgressBadge').textContent = `${courseProgress.percentage}% Complete`;

        await this.loadCourseModules(courseId);
        await this.loadCourseDownloads(courseId);
        
        this.renderModules();
        this.renderDownloads();
    }

    // MODULE RENDERING AND VIDEO PLAYER
    renderModules() {
        const modulesList = document.getElementById('modulesList');
        if (!modulesList) return;

        modulesList.innerHTML = this.modules.map((module, index) => {
            const hasAccess = this.hasModuleAccess(module);
            const isCompleted = this.userProgress[module.id]?.completed;
            const isActive = this.currentModule?.id === module.id;
            
            let status = 'locked';
            let statusText = 'LOCKED';
            
            if (hasAccess) {
                if (isCompleted) {
                    status = 'completed';
                    statusText = 'COMPLETED';
                } else if (isActive) {
                    status = 'active';
                    statusText = 'PLAYING';
                } else {
                    status = 'available';
                    statusText = 'AVAILABLE';
                }
            }

            return `
                <div class="module-item ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''} ${!hasAccess ? 'locked' : ''}" 
                     onclick="lmsManager.selectModule('${module.id}')">
                    <div class="module-header">
                        <div class="module-info">
                            <span class="module-number">${(index + 1).toString().padStart(2, '0')}</span>
                            <span class="module-title">${module.title} ${!hasAccess ? '🔒' : ''}</span>
                            <div class="module-meta">
                                <span class="module-duration">${module.duration || 'N/A'}</span>
                                <span>Tier: ${module.required_tier}</span>
                                ${module.is_premium ? '<span class="course-tier">PREMIUM</span>' : ''}
                            </div>
                        </div>
                        <span class="module-status status-${status}">${statusText}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    async selectModule(moduleId) {
        const module = this.modules.find(m => m.id === moduleId);
        if (!module || !this.hasModuleAccess(module)) return;

        this.currentModule = module;
        
        // Update UI
        this.renderModules();
        
        // Show video section
        document.getElementById('videoSection').style.display = 'block';
        
        // Update module info
        document.getElementById('currentModuleTitle').textContent = module.title;
        document.getElementById('moduleDescription').textContent = module.description;
        document.getElementById('moduleDuration').textContent = module.duration || 'N/A';
        document.getElementById('moduleTier').textContent = module.required_tier;
        
        const isCompleted = this.userProgress[module.id]?.completed;
        document.getElementById('moduleStatus').textContent = isCompleted ? 'Completed' : 'In Progress';
        document.getElementById('completeModule').style.display = isCompleted ? 'none' : 'block';

        // Load Mux video player
        this.loadVideoPlayer(module.video_url);

        // Track module access
        await this.trackModuleAccess(module.id);
    }

    loadVideoPlayer(videoUrl) {
        const videoPlayer = document.getElementById('videoPlayer');
        
        if (!videoUrl) {
            videoPlayer.innerHTML = `
                <div class="video-placeholder">
                    <div class="placeholder-content">
                        <div class="lock-icon">🎬</div>
                        <h3>Video Content</h3>
                        <p>Video URL not configured</p>
                    </div>
                </div>
            `;
            return;
        }

        // Clear previous player
        videoPlayer.innerHTML = '';

        // Create Mux player
        const muxPlayer = document.createElement('mux-player');
        muxPlayer.setAttribute('stream-type', 'on-demand');
        muxPlayer.setAttribute('playback-id', this.extractPlaybackId(videoUrl));
        muxPlayer.setAttribute('controls', '');
        muxPlayer.style.width = '100%';
        muxPlayer.style.height = '100%';

        videoPlayer.appendChild(muxPlayer);
    }

    extractPlaybackId(videoUrl) {
        // Extract playback ID from Mux URL
        // This is a simple extraction - you might need to adjust based on your Mux URL format
        const match = videoUrl.match(/(?:mux\.com\/|playback_id=)([a-zA-Z0-9]+)/);
        return match ? match[1] : videoUrl;
    }

    async trackModuleAccess(moduleId) {
        try {
            const { error } = await supabase
                .from('user_activity')
                .insert([{
                    user_id: this.currentUser.id,
                    activity_type: 'module_access',
                    module_id: moduleId,
                    course_id: this.currentCourse.id,
                    metadata: { module_title: this.currentModule.title }
                }]);

            if (error) throw error;

            // Also update last accessed in progress
            await supabase
                .from('user_progress')
                .upsert({
                    user_id: this.currentUser.id,
                    module_id: moduleId,
                    last_accessed: new Date().toISOString()
                }, {
                    onConflict: 'user_id,module_id'
                });

            await this.loadUserActivity();
            
        } catch (error) {
            console.error('Error tracking module access:', error);
        }
    }

    async markModuleComplete() {
        if (!this.currentModule) return;

        try {
            const { error } = await supabase
                .from('user_progress')
                .upsert({
                    user_id: this.currentUser.id,
                    module_id: this.currentModule.id,
                    completed: true,
                    progress_percentage: 100,
                    completed_at: new Date().toISOString()
                }, {
                    onConflict: 'user_id,module_id'
                });

            if (error) throw error;

            // Track completion activity
            await supabase
                .from('user_activity')
                .insert([{
                    user_id: this.currentUser.id,
                    activity_type: 'module_complete',
                    module_id: this.currentModule.id,
                    course_id: this.currentCourse.id,
                    metadata: { module_title: this.currentModule.title }
                }]);

            await this.loadUserProgress();
            await this.loadUserActivity();
            this.updateProgress();
            this.renderModules();

            document.getElementById('moduleStatus').textContent = 'Completed';
            document.getElementById('completeModule').style.display = 'none';

            this.showMessage('🎉 Module marked as complete!', 'success');
            
        } catch (error) {
            console.error('Error marking module complete:', error);
            this.showMessage('❌ Error completing module: ' + error.message, 'error');
        }
    }

    previousModule() {
        const currentIndex = this.modules.findIndex(m => m.id === this.currentModule.id);
        if (currentIndex > 0) {
            const prevModule = this.modules[currentIndex - 1];
            if (this.hasModuleAccess(prevModule)) {
                this.selectModule(prevModule.id);
            }
        }
    }

    nextModule() {
        const currentIndex = this.modules.findIndex(m => m.id === this.currentModule.id);
        if (currentIndex < this.modules.length - 1) {
            const nextModule = this.modules[currentIndex + 1];
            if (this.hasModuleAccess(nextModule)) {
                this.selectModule(nextModule.id);
            }
        }
    }

    // DOWNLOADS RENDERING
    renderDownloads() {
        const downloadsList = document.getElementById('downloadsList');
        if (!downloadsList) return;

        downloadsList.innerHTML = this.downloads.map(download => {
            const hasAccess = this.hasDownloadAccess(download);
            
            return `
                <div class="download-item ${!hasAccess ? 'locked' : ''}">
                    <div class="download-info">
                        <h4>${download.title} ${!hasAccess ? '🔒' : ''}</h4>
                        <span class="file-size">${download.file_size}</span>
                    </div>
                    <div class="download-actions">
                        ${!hasAccess ? 
                            '<button class="btn-secondary" disabled>Premium Required</button>' :
                            `<a href="${download.file_url}" target="_blank" class="cta-button">Download</a>`
                        }
                    </div>
                    ${!hasAccess ? 
                        '<div class="premium-lock-message">Upgrade to Premium to download this resource</div>' : 
                        ''
                    }
                </div>
            `;
        }).join('');
    }

    // PROGRESS TRACKING
    getCourseProgress(courseId) {
        const courseModules = this.modules.filter(m => m.course_id === courseId);
        const completedModules = courseModules.filter(module => 
            this.userProgress[module.id]?.completed
        ).length;

        return {
            completed: completedModules,
            total: courseModules.length,
            percentage: courseModules.length > 0 ? Math.round((completedModules / courseModules.length) * 100) : 0
        };
    }

    updateProgress() {
        // Calculate overall progress across all courses
        let totalModules = 0;
        let completedModules = 0;

        this.courses.forEach(course => {
            if (this.hasCourseAccess(course.id)) {
                const courseProgress = this.getCourseProgress(course.id);
                completedModules += courseProgress.completed;
                totalModules += courseProgress.total;
            }
        });

        const progressPercentage = totalModules > 0 ? Math.round((completedModules / totalModules) * 100) : 0;

        // Update progress circle
        const circle = document.getElementById('completionCircle');
        const percent = document.getElementById('completionPercent');
        const displayProgress = document.getElementById('displayProgress');
        
        const circumference = 339.292;
        const offset = circumference - (progressPercentage / 100) * circumference;
        
        if (circle) circle.style.strokeDashoffset = offset;
        if (percent) percent.textContent = progressPercentage + '%';
        if (displayProgress) displayProgress.textContent = progressPercentage + '%';

        // Update course progress list
        this.renderCourseProgressList();
    }

    renderCourseProgressList() {
        const container = document.getElementById('courseProgressList');
        if (!container) return;

        container.innerHTML = this.courses.map(course => {
            if (!this.hasCourseAccess(course.id)) return '';

            const progress = this.getCourseProgress(course.id);
            
            return `
                <div class="course-progress-item">
                    <div class="course-progress-info">
                        <h4>${course.title}</h4>
                        <div class="course-progress-stats">
                            <span>${progress.completed} of ${progress.total} modules</span>
                            <span>${progress.percentage}% complete</span>
                        </div>
                    </div>
                    <div class="course-progress-bar">
                        <div class="course-progress-fill" style="width: ${progress.percentage}%"></div>
                    </div>
                </div>
            `;
        }).join('');
    }

    renderUserActivity() {
        const container = document.getElementById('userActivityList');
        if (!container) return;

        if (this.userActivity.length === 0) {
            container.innerHTML = '<div class="activity-item">No recent activity</div>';
            return;
        }

        container.innerHTML = this.userActivity.map(activity => {
            let activityText = '';
            switch (activity.activity_type) {
                case 'module_access':
                    activityText = `Started watching: ${activity.metadata?.module_title || 'a module'}`;
                    break;
                case 'module_complete':
                    activityText = `Completed: ${activity.metadata?.module_title || 'a module'}`;
                    break;
                case 'course_purchase':
                    activityText = `Purchased a course`;
                    break;
                default:
                    activityText = 'Activity recorded';
            }

            return `
                <div class="activity-item">
                    <div>${activityText}</div>
                    <small>${new Date(activity.created_at).toLocaleString()}</small>
                </div>
            `;
        }).join('');
    }

    // PAYMENT AND UPGRADE
    canPurchaseCourse(course) {
        const tierLevel = { 'basic': 1, 'premium': 2 };
        const userTierLevel = tierLevel[this.userProfile?.subscription_tier] || 1;
        const courseTierLevel = tierLevel[course.required_tier] || 1;
        
        return userTierLevel >= courseTierLevel && !this.hasCourseAccess(course.id);
    }

    async purchaseCourse(courseId) {
        const course = this.courses.find(c => c.id === courseId);
        if (!course) return;

        try {
            const { data, error } = await supabase
                .from('user_courses')
                .insert([{
                    user_id: this.currentUser.id,
                    course_id: courseId,
                    payment_status: 'completed',
                    purchased_price: course.price
                }]);

            if (error) throw error;

            // Track purchase activity
            await supabase
                .from('user_activity')
                .insert([{
                    user_id: this.currentUser.id,
                    activity_type: 'course_purchase',
                    course_id: courseId,
                    metadata: { course_title: course.title, price: course.price }
                }]);

            // Update user tier if purchasing higher tier course
            const tierLevel = { 'basic': 1, 'premium': 2 };
            const currentTierLevel = tierLevel[this.userProfile.subscription_tier] || 1;
            const courseTierLevel = tierLevel[course.required_tier] || 1;
            
            if (courseTierLevel > currentTierLevel) {
                await supabase
                    .from('profiles')
                    .update({ subscription_tier: course.required_tier })
                    .eq('id', this.currentUser.id);
            }

            this.showMessage('🎉 Course purchased successfully! You now have access.', 'success');
            await this.loadUserData();
            await this.loadUserCourses();
            await this.loadUserActivity();
            this.renderCourses();
            this.checkUpgradePrompt();
            
        } catch (error) {
            console.error('Error purchasing course:', error);
            this.showMessage('❌ Purchase failed: ' + error.message, 'error');
        }
    }

    async processUpgrade() {
        try {
            // Update user tier to premium
            const { error } = await supabase
                .from('profiles')
                .update({ subscription_tier: 'premium' })
                .eq('id', this.currentUser.id);

            if (error) throw error;

            // Track upgrade activity
            await supabase
                .from('user_activity')
                .insert([{
                    user_id: this.currentUser.id,
                    activity_type: 'tier_upgrade',
                    metadata: { from_tier: 'basic', to_tier: 'premium' }
                }]);

            this.showMessage('🎉 Successfully upgraded to Premium!', 'success');
            await this.loadUserData();
            await this.loadUserActivity();
            this.checkUpgradePrompt();
            
            // Refresh current view if on course details
            if (this.currentCourse) {
                this.renderModules();
                this.renderDownloads();
            }
            
            closeUpgradeModal();
            
        } catch (error) {
            console.error('Error upgrading tier:', error);
            this.showMessage('❌ Upgrade failed: ' + error.message, 'error');
        }
    }

    // UTILITY METHODS
    showMessage(message, type) {
        // Create temporary message element
        const messageEl = document.createElement('div');
        messageEl.className = `form-message ${type}`;
        messageEl.textContent = message;
        messageEl.style.position = 'fixed';
        messageEl.style.top = '100px';
        messageEl.style.right = '20px';
        messageEl.style.zIndex = '3000';
        
        document.body.appendChild(messageEl);
        
        setTimeout(() => {
            messageEl.remove();
        }, 5000);
    }

    async logout() {
        try {
            const { error } = await supabase.auth.signOut();
            if (error) throw error;
            window.location.href = 'login.html';
        } catch (error) {
            console.error('Logout error:', error);
            this.showMessage('Logout failed: ' + error.message, 'error');
        }
    }
}

// Global functions
function backToCourses() {
    document.getElementById('coursesView').style.display = 'block';
    document.getElementById('courseDetailsView').style.display = 'none';
    document.getElementById('videoSection').style.display = 'none';
}

function showUpgradeModal() {
    document.getElementById('upgradeModal').classList.add('active');
}

function closeUpgradeModal() {
    document.getElementById('upgradeModal').classList.remove('active');
}

function closePurchaseModal() {
    document.getElementById('purchaseModal').classList.remove('active');
}

function processUpgrade(method) {
    if (method === 'manual') {
        alert('Please contact support for manual payment processing.');
        return;
    }
    lmsManager.processUpgrade();
}

function processPayment(method) {
    alert(`In production, this would process ${method} payment.`);
    closePurchaseModal();
}

// Mobile Menu Functions
function closeMobileMenu() {
    document.getElementById('mobileMenu').classList.remove('active');
    document.getElementById('mobileMenuOverlay').classList.remove('active');
    document.body.classList.remove('menu-open');
}

// Initialize LMS Manager
document.addEventListener('DOMContentLoaded', function() {
    // Supabase Configuration
    const SUPABASE_URL = 'https://dawxhfdvozykhxkzpfbv.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhd3hoZmR2b3p5a2h4a3pwZmJ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1MTgyMzAsImV4cCI6MjA5OTA5NDIzMH0.MiGLrpu3i-5u9hyQrdyBFm9J5pb689Oe21eUsKUjbyU';

    window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    window.lmsManager = new LMSManager();
});

// Auth state listener
supabase.auth.onAuthStateChange((event, session) => {
    if (window.lmsManager) {
        window.lmsManager.checkAuthState();
    }
});
