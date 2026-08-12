// Client-side Router for LMS with Auth Validation
class LMSRouter {
    constructor() {
        this.routes = {
            '/': 'index.html',
            '/my-courses': 'my-courses.html',
            '/course/:id': 'course-detail.html',
            '/video/:courseId/:moduleId': 'video-view.html',
            '/login': 'login.html',
            '/admin': 'admin.html',
            '/checkout': 'checkout.html',
            '/checkout-status': 'checkout-status.html'
        };
        
        this.currentParams = {};
        this.init();
    }

    init() {
        // Handle browser back/forward
        window.addEventListener('popstate', (e) => {
            if (e.state) {
                this.handleRoute(e.state.path, false);
            }
        });

        // Intercept all link clicks
        document.addEventListener('click', (e) => {
            const link = e.target.closest('a[href]');
            if (link && link.href && !link.target && !link.download) {
                const url = new URL(link.href);
                if (url.origin === window.location.origin) {
                    e.preventDefault();
                    this.navigate(url.pathname + url.search);
                }
            }
        });

        // Handle initial load
        this.handleRoute(window.location.pathname + window.location.search, true);
    }

    async handleRoute(path, isInitialLoad = true) {
        const url = new URL(path, window.location.origin);
        const pathname = url.pathname;
        
        // Check authentication for protected routes
        const protectedRoutes = ['/', '/my-courses', '/course/', '/video/', '/admin'];
        const checkoutRoutes = ['/checkout', '/checkout-status'];
        const isCheckout = checkoutRoutes.some(route => pathname === route || pathname.startsWith(route + '?') || pathname.startsWith(route + '/'));
        const isProtected = protectedRoutes.some(route => 
            pathname === route || pathname.startsWith(route + '/') || pathname.startsWith(route + '?')
        ) || isCheckout;

        if (isProtected && !await this.isAuthenticated()) {
            if (pathname !== '/login') {
                this.navigateToLogin();
                return;
            }
        }

        // Parse route parameters
        this.parseRouteParams(pathname);
        
        // Update browser history
        if (!isInitialLoad) {
            history.pushState({ path: pathname }, '', path);
        }

        // Load the appropriate page
        await this.loadPage(pathname);
    }

    parseRouteParams(pathname) {
        this.currentParams = {};
        
        // Match /course/:id
        const courseMatch = pathname.match(/^\/course\/([^\/]+)$/);
        if (courseMatch) {
            this.currentParams.courseId = courseMatch[1];
            this.currentParams.page = 'course-detail';
            return;
        }

        // Match /video/:courseId/:moduleId
        const videoMatch = pathname.match(/^\/video\/([^\/]+)\/([^\/]+)$/);
        if (videoMatch) {
            this.currentParams.courseId = videoMatch[1];
            this.currentParams.moduleId = videoMatch[2];
            this.currentParams.page = 'video-view';
            return;
        }

        // Match /checkout-status
        const checkoutStatusMatch = pathname.match(/^\/checkout-status(?:\.html)?$/);
        if (checkoutStatusMatch) {
            this.currentParams.page = 'checkout-status';
            return;
        }

        // Match /checkout
        const checkoutMatch = pathname.match(/^\/checkout(?:\.html)?$/);
        if (checkoutMatch) {
            this.currentParams.page = 'checkout';
            return;
        }

        // Default routes
        if (pathname === '/' || pathname === '/index.html') {
            this.currentParams.page = 'dashboard';
        } else if (pathname === '/my-courses' || pathname === '/my-courses.html') {
            this.currentParams.page = 'my-courses';
        } else if (pathname === '/login' || pathname === '/login.html') {
            this.currentParams.page = 'login';
        } else if (pathname === '/admin' || pathname === '/admin.html') {
            this.currentParams.page = 'admin';
        }
    }

    async isAuthenticated() {
        if (!window.supabase) {
            // Wait for supabase to initialize
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        try {
            const { data: { session } } = await supabase.auth.getSession();
            return !!session;
        } catch (error) {
            console.error('Auth check error:', error);
            return false;
        }
    }

    navigateToLogin() {
        const currentPath = window.location.pathname + window.location.search;
        window.location.href = `/login.html?redirect=${encodeURIComponent(currentPath)}`;
    }

    async loadPage(pathname) {
        // Determine which page to load
        let targetPage = null;

        if (pathname === '/' || pathname === '/index.html') {
            targetPage = 'index.html';
        } else if (pathname === '/my-courses' || pathname === '/my-courses.html') {
            targetPage = 'my-courses.html';
        } else if (this.currentParams.page === 'course-detail') {
            targetPage = 'course-detail.html';
        } else if (this.currentParams.page === 'video-view') {
            targetPage = 'video-view.html';
        } else if (pathname === '/login' || pathname === '/login.html') {
            targetPage = 'login.html';
        } else if (pathname === '/admin' || pathname === '/admin.html') {
            targetPage = 'admin.html';
        } else if (this.currentParams.page === 'checkout') {
            targetPage = 'checkout.html';
        } else if (this.currentParams.page === 'checkout-status') {
            targetPage = 'checkout-status.html';
        } else {
            // 404 - redirect to home
            targetPage = 'index.html';
        }

        // If we're already on the right page, just trigger page initialization
        const currentPage = window.location.pathname.split('/').pop() || 'index.html';
        if (currentPage === targetPage || 
            (this.currentParams.page === 'course-detail' && currentPage === 'course-detail.html') ||
            (this.currentParams.page === 'video-view' && currentPage === 'video-view.html')) {
            
            // Trigger page re-initialization for dynamic content
            this.triggerPageInit();
            return;
        }

        // Navigate to the target page
        window.location.href = targetPage;
    }

    triggerPageInit() {
        // Dispatch custom event for page initialization
        window.dispatchEvent(new CustomEvent('routeChanged', { 
            detail: { 
                params: this.currentParams,
                path: window.location.pathname 
            } 
        }));
    }

    navigate(path) {
        const url = new URL(path, window.location.origin);
        this.handleRoute(url.pathname + url.search, false);
    }

    // Helper methods for navigation
    goToMyCourses() {
        this.navigate('/my-courses');
    }

    goToCourse(courseId) {
        this.navigate(`/course/${courseId}`);
    }

    goToVideo(courseId, moduleId) {
        this.navigate(`/video/${courseId}/${moduleId}`);
    }

    goToHome() {
        this.navigate('/');
    }

    goBack() {
        history.back();
    }
}

// Initialize router when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.lmsRouter = new LMSRouter();
});

// Export for use in other scripts
window.LMSRouter = LMSRouter;
