// Centralized Supabase Client and Authentication Manager
// This single file handles all authentication and session management
// Include this script BEFORE any other scripts that need auth

(function() {
    'use strict';

    // Configuration - Use window.LMS_CONFIG if available, otherwise use defaults
    const SUPABASE_URL = (window.LMS_CONFIG && window.LMS_CONFIG.SUPABASE_URL) || 
                         'https://bvavtdyxuzzabzgodbjw.supabase.co';
    const SUPABASE_ANON_KEY = (window.LMS_CONFIG && window.LMS_CONFIG.SUPABASE_ANON_KEY) || 
                              'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ2YXZ0ZHl4dXp6YWJ6Z29kYmp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxOTc2OTksImV4cCI6MjA4OTc3MzY5OX0.gqfiaeDtWBtuyj_CQCaiySVA2-VmuM9CVvd5N-gRlV8';

    // Create a singleton Supabase client
    let supabaseClient = null;
    let currentSession = null;
    let sessionListeners = [];
    let authInitialized = false;
    let initPromise = null;

    // Auth Manager Class
    class AuthManager {
        constructor() {
            if (AuthManager.instance) {
                return AuthManager.instance;
            }
            AuthManager.instance = this;
        }

        // Initialize Supabase client (must be called before any auth operations)
        init() {
            if (authInitialized) {
                return Promise.resolve(this.getSupabase());
            }

            if (initPromise) {
                return initPromise;
            }

            initPromise = new Promise((resolve) => {
                // Wait for Supabase SDK to load if not already available
                if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
                    console.warn('[AuthManager] Supabase SDK not loaded yet, waiting...');
                    const checkInterval = setInterval(() => {
                        if (window.supabase && window.supabase.createClient) {
                            clearInterval(checkInterval);
                            this._createClient();
                            resolve(this.getSupabase());
                        }
                    }, 50);
                    
                    // Timeout after 5 seconds
                    setTimeout(() => {
                        clearInterval(checkInterval);
                        if (!authInitialized) {
                            console.error('[AuthManager] Supabase SDK failed to load after 5 seconds');
                            resolve(null);
                        }
                    }, 5000);
                } else {
                    this._createClient();
                    resolve(this.getSupabase());
                }
            });

            return initPromise;
        }

        _createClient() {
            if (!supabaseClient) {
                supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
                
                // Set up auth state change listener
                supabaseClient.auth.onAuthStateChange((event, session) => {
                    console.log('[AuthManager] Auth state changed:', event);
                    currentSession = session;
                    this._notifyListeners(event, session);
                });

                authInitialized = true;
                console.log('[AuthManager] Supabase client initialized successfully');
            }
        }

        getSupabase() {
            return supabaseClient;
        }

        get supabase() {
            return supabaseClient;
        }

        // Get current session (cached)
        getSession() {
            return currentSession;
        }

        // Force refresh session from Supabase
        async refreshSession() {
            if (!supabaseClient) {
                await this.init();
            }

            try {
                const { data: { session }, error } = await supabaseClient.auth.getSession();
                if (error) {
                    console.error('[AuthManager] Error refreshing session:', error);
                    currentSession = null;
                    return null;
                }
                currentSession = session;
                return session;
            } catch (error) {
                console.error('[AuthManager] Error getting session:', error);
                currentSession = null;
                return null;
            }
        }

        // Check if user is authenticated
        async isAuthenticated() {
            const session = await this.refreshSession();
            return !!session;
        }

        // Get current user
        getCurrentUser() {
            return currentSession?.user || null;
        }

        // Add session change listener
        onAuthStateChange(callback) {
            sessionListeners.push(callback);
            // Return unsubscribe function
            return () => {
                sessionListeners = sessionListeners.filter(listener => listener !== callback);
            };
        }

        // Notify all listeners of auth state change
        _notifyListeners(event, session) {
            sessionListeners.forEach(callback => {
                try {
                    callback(event, session);
                } catch (error) {
                    console.error('[AuthManager] Error in auth state listener:', error);
                }
            });
        }

        // Sign out
        async signOut() {
            if (!supabaseClient) {
                throw new Error('[AuthManager] Supabase client not initialized');
            }

            try {
                const { error } = await supabaseClient.auth.signOut();
                if (error) throw error;
                currentSession = null;
                console.log('[AuthManager] User signed out successfully');
            } catch (error) {
                console.error('[AuthManager] Error signing out:', error);
                throw error;
            }
        }

        // Get configuration values
        getConfig() {
            return {
                SUPABASE_URL,
                SUPABASE_ANON_KEY
            };
        }
    }

    // Create singleton instance
    const authManager = new AuthManager();

    // Expose to window object
    window.AuthManager = authManager;
    window.authManager = authManager;

    // Also expose supabase client directly for backward compatibility
    // Only define if not already defined by the SDK
    if (!window.supabase || typeof window.supabase.from !== 'function') {
        Object.defineProperty(window, 'supabase', {
            get: function() {
                return authManager.getSupabase();
            },
            configurable: true
        });
    }

    // Auto-initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => authManager.init());
    } else {
        authManager.init();
    }

    // Export for module systems (optional)
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = AuthManager;
    }

})();
