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

        // Snapshot which route is ACTUALLY loaded in the DOM right now, before
        // anything (including our own history.pushState calls) can change
        // window.location. This is what "are we already on the right page"
        // must be compared against -- see loadPage() for why.
        this.loadedRoute = this.resolveRoute(window.location.pathname);

        this.init();
    }

    // Pure route-matching: given a pathname, figure out which page/file it
    // maps to and pull out any params (courseId, moduleId). Used both to
    // record what's currently loaded and to figure out navigation targets,
    // so the two can be compared consistently.
    resolveRoute(pathname) {
        const courseMatch = pathname.match(/^\/course\/([^\/]+)$/);
        if (courseMatch) {
            return { page: 'course-detail', file: 'course-detail.html', courseId: courseMatch[1] };
        }

        const videoMatch = pathname.match(/^\/video\/([^\/]+)\/([^\/]+)$/);
        if (videoMatch) {
            return { page: 'video-view', file: 'video-view.html', courseId: videoMatch[1], moduleId: videoMatch[2] };
        }

        if (/^\/checkout-status(?:\.html)?$/.test(pathname)) {
            return { page: 'checkout-status', file: 'checkout-status.html' };
        }

        if (/^\/checkout(?:\.html)?$/.test(pathname)) {
            return { page: 'checkout', file: 'checkout.html' };
        }

        if (pathname === '/my-courses' || pathname === '/my-courses.html') {
            return { page: 'my-courses', file: 'my-courses.html' };
        }

        if (pathname === '/login' || pathname === '/login.html') {
            return { page: 'login', file: 'login.html' };
        }

        if (pathname === '/admin' || pathname === '/admin.html') {
            return { page: 'admin', file: 'admin.html' };
        }

        // '/', '/index.html', and anything unrecognized fall back to the dashboard
        return { page: 'dashboard', file: 'index.html' };
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
        const route = this.resolveRoute(pathname);
        this.currentParams = {};
        if (route.courseId !== undefined) this.currentParams.courseId = route.courseId;
        if (route.moduleId !== undefined) this.currentParams.moduleId = route.moduleId;
        this.currentParams.page = route.page;
    }

    async isAuthenticated() {
        // Use centralized AuthManager if available, otherwise fall back to direct supabase check
        const authManager = window.AuthManager || window.authManager;
        
        if (authManager && typeof authManager.isAuthenticated === 'function') {
            // Wait for AuthManager to be initialized
            if (typeof authManager.init === 'function') {
                await authManager.init();
            }
            return await authManager.isAuthenticated();
        }

        // Fallback to direct supabase check for backward compatibility
        const clientReady = () => !!(window.supabase && window.supabase.auth && typeof window.supabase.auth.getSession === 'function');

        if (!clientReady()) {
            const start = Date.now();
            while (!clientReady() && Date.now() - start < 5000) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        if (!clientReady()) {
            console.error('Auth check error: Supabase client never initialized');
            return false;
        }

        try {
            // First attempt to get session
            let { data: { session }, error } = await window.supabase.auth.getSession();
            
            // If no session but we have a user (token might need refresh), wait a bit and retry
            if (!session && !error) {
                const events = ['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'];
                const start = Date.now();
                
                // Wait up to 3 seconds for a session to appear (in case refresh is in progress)
                while (!session && Date.now() - start < 3000) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    ({ data: { session: newSession } } = await window.supabase.auth.getSession());
                    if (newSession) {
                        session = newSession;
                        break;
                    }
                }
            }
            
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
        const target = this.resolveRoute(pathname);

        // "Are we already showing the right thing?" has to be checked against
        // this.loadedRoute (captured once, before any pushState this session
        // could have touched), NOT against window.location.pathname.split('/').pop().
        // On Vercel, pretty routes like /course/45 are rewritten server-side to
        // serve course-detail.html while the URL bar stays /course/45 -- so
        // pathname.split('/').pop() gives "45", which will never equal
        // "course-detail.html". That mismatch made this check always fail for
        // every parameterized route, forcing an unnecessary full-page reload
        // on every single navigation into a course or video page.
        const sameFile = this.loadedRoute.file === target.file;
        const sameResource = (target.page === 'course-detail' || target.page === 'video-view')
            ? (this.loadedRoute.courseId === target.courseId && this.loadedRoute.moduleId === target.moduleId)
            : true;

        if (sameFile && sameResource) {
            this.triggerPageInit();
            return;
        }

        // Navigate using the pretty path itself (e.g. "/course/45"), not a bare
        // relative filename like "course-detail.html". A bare relative filename
        // resolves against whatever directory-like path is currently in the
        // address bar (which may already be a nested pretty URL, e.g. /course/12,
        // from a previous pushState) and breaks -- e.g. resolving to
        // /course/course-detail.html, which doesn't exist and can even get
        // re-captured by Vercel's own /course/:id rewrite. Using the absolute
        // pretty path also preserves courseId/moduleId across the reload.
        window.location.href = pathname;
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