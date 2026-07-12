// Admin Panel JavaScript
class AdminPanel {
    constructor() {
        this.currentUser = null;
        this.courses = [];
        this.students = [];
        this.modules = [];
        this.filteredCourses = [];
        this.currentFilter = 'all';
        this.currentCourseId = null;
        this.init();
    }

    async init() {
        await this.checkAdminAuth();
        await this.loadDashboardData();
        this.setupEventListeners();
        this.renderDashboard();
    }

    async checkAdminAuth() {
        console.log('🔍 Checking admin auth...');
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (session?.user) {
            console.log('👤 User session found:', session.user.email);
            this.currentUser = session.user;
            
            const isAdmin = await this.checkAdminRole(session.user.id);
            console.log('🛡️ Admin check result:', isAdmin);
            
            if (!isAdmin) {
                console.log('❌ Access denied - not admin');
                this.redirectToLogin('Access denied. Admin privileges required.');
                return;
            }
            
            this.currentUser = session.user;
            document.getElementById('adminEmail').textContent = session.user.email;
            document.getElementById('mobileAdminEmail').textContent = session.user.email;
            console.log('✅ Admin access granted');
            
        } else {
            console.log('❌ No user session found');
            this.redirectToLogin('Please login to access admin panel.');
        }
    }

    async checkAdminRole(userId) {
        // Simple email-based admin check
        const adminEmails = ['graphicyin@gmail.com'];
        
        if (!this.currentUser || !this.currentUser.email) {
            console.log('❌ No current user or email found');
            return false;
        }
        
        const isAdmin = adminEmails.includes(this.currentUser.email.toLowerCase());
        console.log('🛡️ Admin check for', this.currentUser.email, ':', isAdmin);
        return isAdmin;
    }

    redirectToLogin(message = '') {
        console.log('🔀 Redirecting to login:', message);
        if (message) {
            localStorage.setItem('adminLoginMessage', message);
        }
        window.location.href = 'admin-login.html';
    }

    setupEventListeners() {
        // Logout buttons
        document.getElementById('adminLogoutBtn').addEventListener('click', () => this.logout());
        document.getElementById('mobileAdminLogoutBtn').addEventListener('click', () => this.logout());

        // Course form
        document.getElementById('courseForm').addEventListener('submit', (e) => this.handleCourseSubmit(e));

        // Module form
        document.getElementById('moduleForm').addEventListener('submit', (e) => this.handleModuleSubmit(e));

        // Mobile menu
        this.setupMobileMenu();
    }

    setupMobileMenu() {
        const mobileMenuBtn = document.getElementById('mobileMenuBtn');
        const mobileCloseBtn = document.getElementById('mobileCloseBtn');
        const mobileMenu = document.getElementById('mobileMenu');
        const mobileMenuOverlay = document.getElementById('mobileMenuOverlay');

        if (mobileMenuBtn) {
            mobileMenuBtn.addEventListener('click', () => this.openMobileMenu());
        }
        if (mobileCloseBtn) {
            mobileCloseBtn.addEventListener('click', () => this.closeMobileMenu());
        }
        if (mobileMenuOverlay) {
            mobileMenuOverlay.addEventListener('click', () => this.closeMobileMenu());
        }
    }

    openMobileMenu() {
        document.getElementById('mobileMenu').classList.add('active');
        document.getElementById('mobileMenuOverlay').classList.add('active');
        document.body.classList.add('menu-open');
    }

    closeMobileMenu() {
        document.getElementById('mobileMenu').classList.remove('active');
        document.getElementById('mobileMenuOverlay').classList.remove('active');
        document.body.classList.remove('menu-open');
    }

    async loadDashboardData() {
        await this.loadCourses();
        await this.loadStudents();
        await this.loadStats();
    }

    async loadCourses() {
        try {
            this.showLoading('courses');
            
            const { data, error } = await supabase
                .from('courses')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            
            this.courses = data || [];
            this.filteredCourses = [...this.courses];
            this.renderCourses();
            
        } catch (error) {
            console.error('Error loading courses:', error);
            this.showMessage('Error loading courses: ' + error.message, 'error');
            this.courses = [];
            this.filteredCourses = [];
        }
    }

    async loadStats() {
        try {
            const { data: profiles, error: profilesError } = await supabase
                .from('profiles')
                .select('id');
            
            if (!profilesError && Array.isArray(profiles)) {
                document.getElementById('totalStudents').textContent = profiles.length;
            } else {
                document.getElementById('totalStudents').textContent = '0';
            }

            // Get total courses and active courses
            const { data: courses, error: coursesError } = await supabase
                .from('courses')
                .select('id, is_active');
            
            if (!coursesError) {
                document.getElementById('totalCourses').textContent = courses.length;
                const activeCourses = courses.filter(course => course.is_active).length;
                document.getElementById('activeCourses').textContent = activeCourses;
            }

            // Get total modules
            const { data: modules, error: modulesError } = await supabase
                .from('course_modules')
                .select('id');
            
            if (!modulesError) {
                document.getElementById('totalModules').textContent = modules.length;
            }

        } catch (error) {
            console.error('Error loading stats:', error);
        }
    }

    async loadModules(courseId) {
        try {
            this.showModulesLoading();
            
            const { data, error } = await supabase
                .from('course_modules')
                .select('*')
                .eq('course_id', courseId)
                .order('module_order', { ascending: true });

            if (error) throw error;
            
            this.modules = data || [];
            this.renderModules();
            
        } catch (error) {
            console.error('Error loading modules:', error);
            this.showMessage('Error loading modules: ' + error.message, 'error');
            this.modules = [];
        }
    }

    async loadStudents() {
        try {
            this.showLoading('students');
            
            const { data, error } = await supabase
                .from('profiles')
                .select('id, email, subscription_tier, created_at, updated_at')
                .order('created_at', { ascending: false });

            if (error) {
                const message = (error.message || '').toLowerCase();
                if (message.includes('policy') || message.includes('infinite recursion') || message.includes('permission denied')) {
                    console.warn('Profiles query is blocked by current RLS policy. Showing an empty student list.');
                    this.students = [];
                    this.renderStudents();
                    return;
                }
                throw error;
            }
            
            this.students = data || [];
            this.renderStudents();
            
        } catch (error) {
            console.error('Error loading students:', error);
            this.students = [];
            this.renderStudents();
        }
    }

    // COURSES CRUD OPERATIONS
    async handleCourseSubmit(e) {
        e.preventDefault();
        
        const submitBtn = document.getElementById('courseSubmitBtn');
        const btnText = submitBtn.querySelector('.btn-text');
        const btnLoading = submitBtn.querySelector('.btn-loading');
        
        // Show loading state
        btnText.style.display = 'none';
        btnLoading.style.display = 'inline';
        submitBtn.disabled = true;

        const courseId = document.getElementById('courseId').value;
        const courseData = {
            title: document.getElementById('courseTitle').value,
            description: document.getElementById('courseDescription').value,
            required_tier: document.getElementById('courseTier').value,
            price: parseFloat(document.getElementById('coursePrice').value),
            status: document.getElementById('courseStatus').value,
            is_active: document.getElementById('courseActive').checked
        };

        try {
            if (courseId) {
                // Update existing course
                const { error } = await supabase
                    .from('courses')
                    .update(courseData)
                    .eq('id', courseId);

                if (error) throw error;
                this.showMessage('✅ Course updated successfully!', 'success');
            } else {
                // Create new course
                const { error } = await supabase
                    .from('courses')
                    .insert([courseData]);

                if (error) throw error;
                this.showMessage('✅ Course created successfully!', 'success');
            }

            await this.loadCourses();
            await this.loadStats();
            this.closeCourseModal();
            
        } catch (error) {
            console.error('Error saving course:', error);
            this.showMessage('❌ Error saving course: ' + error.message, 'error');
        } finally {
            // Reset button state
            btnText.style.display = 'inline';
            btnLoading.style.display = 'none';
            submitBtn.disabled = false;
        }
    }

    async toggleCourseStatus(courseId) {
        const course = this.courses.find(c => c.id === courseId);
        if (!course) return;

        try {
            const { error } = await supabase
                .from('courses')
                .update({ is_active: !course.is_active })
                .eq('id', courseId);

            if (error) throw error;

            await this.loadCourses();
            await this.loadStats();
            this.showMessage(`✅ Course ${!course.is_active ? 'activated' : 'deactivated'} successfully!`, 'success');
            
        } catch (error) {
            console.error('Error toggling course status:', error);
            this.showMessage('❌ Error updating course: ' + error.message, 'error');
        }
    }

    async deleteCourse(courseId) {
        const course = this.courses.find(c => c.id === courseId);
        if (!course) return;

        this.showConfirmModal(
            'Delete Course',
            `Are you sure you want to delete "${course.title}"? This action cannot be undone.`,
            async () => {
                try {
                    const { error } = await supabase
                        .from('courses')
                        .delete()
                        .eq('id', courseId);

                    if (error) throw error;

                    await this.loadCourses();
                    await this.loadStats();
                    this.showMessage('✅ Course deleted successfully!', 'success');
                    this.closeConfirmModal();
                    
                } catch (error) {
                    console.error('Error deleting course:', error);
                    this.showMessage('❌ Error deleting course: ' + error.message, 'error');
                }
            }
        );
    }

    // MODULES CRUD OPERATIONS
    async handleModuleSubmit(e) {
        e.preventDefault();
        
        const submitBtn = document.getElementById('moduleSubmitBtn');
        const btnText = submitBtn.querySelector('.btn-text');
        const btnLoading = submitBtn.querySelector('.btn-loading');
        
        // Show loading state
        btnText.style.display = 'none';
        btnLoading.style.display = 'inline';
        submitBtn.disabled = true;

        const moduleId = document.getElementById('moduleId').value;
        const courseId = document.getElementById('moduleCourseId').value;
        const moduleData = {
            course_id: courseId,
            title: document.getElementById('moduleTitle').value,
            description: document.getElementById('moduleDescription').value,
            module_order: parseInt(document.getElementById('moduleOrder').value),
            duration: document.getElementById('moduleDuration').value,
            video_url: document.getElementById('moduleVideoUrl').value,
            required_tier: document.getElementById('moduleTier').value,
            is_premium: document.getElementById('moduleIsPremium').checked
        };

        try {
            if (moduleId) {
                // Update existing module
                const { error } = await supabase
                    .from('course_modules')
                    .update(moduleData)
                    .eq('id', moduleId);

                if (error) throw error;
                this.showMessage('✅ Module updated successfully!', 'success');
            } else {
                // Create new module
                const { error } = await supabase
                    .from('course_modules')
                    .insert([moduleData]);

                if (error) throw error;
                this.showMessage('✅ Module created successfully!', 'success');
            }

            await this.loadModules(courseId);
            await this.loadStats();
            this.closeModuleModal();
            
        } catch (error) {
            console.error('Error saving module:', error);
            this.showMessage('❌ Error saving module: ' + error.message, 'error');
        } finally {
            // Reset button state
            btnText.style.display = 'inline';
            btnLoading.style.display = 'none';
            submitBtn.disabled = false;
        }
    }

    async deleteModule(moduleId) {
        const module = this.modules.find(m => m.id === moduleId);
        if (!module) return;

        this.showConfirmModal(
            'Delete Module',
            `Are you sure you want to delete "${module.title}"? This action cannot be undone.`,
            async () => {
                try {
                    const { error } = await supabase
                        .from('course_modules')
                        .delete()
                        .eq('id', moduleId);

                    if (error) throw error;

                    await this.loadModules(this.currentCourseId);
                    await this.loadStats();
                    this.showMessage('✅ Module deleted successfully!', 'success');
                    this.closeConfirmModal();
                    
                } catch (error) {
                    console.error('Error deleting module:', error);
                    this.showMessage('❌ Error deleting module: ' + error.message, 'error');
                }
            }
        );
    }

    // COURSES RENDERING AND FILTERING
    renderCourses() {
        const container = document.getElementById('adminCoursesList');
        if (!container) return;

        if (this.filteredCourses.length === 0) {
            container.innerHTML = `
                <div class="placeholder-message">
                    <p>No courses found. Click "Add New Course" to get started.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.filteredCourses.map(course => {
            const statusClass = `status-${course.status}`;
            const statusText = course.status.charAt(0).toUpperCase() + course.status.slice(1);
            
            return `
                <div class="course-item ${!course.is_active ? 'inactive' : ''}">
                    <div class="course-header">
                        <div class="course-info">
                            <h3>${course.title}</h3>
                            <div class="course-meta">
                                <span class="course-tier">${course.required_tier.toUpperCase()} TIER</span>
                                <span class="course-price">$${course.price}</span>
                                <span class="course-status ${statusClass}">${statusText}</span>
                                ${!course.is_active ? '<span class="course-status status-inactive">INACTIVE</span>' : ''}
                            </div>
                        </div>
                        <div class="course-actions">
                            <button class="btn-small" onclick="adminPanel.openCourseModal('${course.id}')">Edit</button>
                            <button class="btn-small ${course.is_active ? 'btn-danger' : 'btn-success'}" 
                                    onclick="adminPanel.toggleCourseStatus('${course.id}')">
                                ${course.is_active ? 'Deactivate' : 'Activate'}
                            </button>
                            <button class="btn-small" onclick="adminPanel.viewModules('${course.id}')">Modules</button>
                            <button class="btn-small btn-danger" onclick="adminPanel.deleteCourse('${course.id}')">Delete</button>
                        </div>
                    </div>
                    <div class="course-description">
                        <p>${course.description}</p>
                    </div>
                </div>
            `;
        }).join('');
    }

    filterCourses(filter) {
        this.currentFilter = filter;
        
        // Update filter buttons
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        event.target.classList.add('active');

        switch (filter) {
            case 'active':
                this.filteredCourses = this.courses.filter(course => course.is_active);
                break;
            case 'inactive':
                this.filteredCourses = this.courses.filter(course => !course.is_active);
                break;
            case 'basic':
                this.filteredCourses = this.courses.filter(course => course.required_tier === 'basic');
                break;
            case 'premium':
                this.filteredCourses = this.courses.filter(course => course.required_tier === 'premium');
                break;
            default:
                this.filteredCourses = [...this.courses];
        }

        this.renderCourses();
    }

    searchCourses(query) {
        if (!query.trim()) {
            this.filteredCourses = [...this.courses];
        } else {
            const searchTerm = query.toLowerCase();
            this.filteredCourses = this.courses.filter(course => 
                course.title.toLowerCase().includes(searchTerm) ||
                course.description.toLowerCase().includes(searchTerm) ||
                course.required_tier.toLowerCase().includes(searchTerm)
            );
        }
        this.renderCourses();
    }

    // MODULES RENDERING
    renderModules() {
        const container = document.getElementById('modulesListView');
        if (!container) return;

        if (this.modules.length === 0) {
            container.innerHTML = `
                <div class="placeholder-message">
                    <p>No modules found. Click "Add Module" to get started.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.modules.map(module => {
            return `
                <div class="module-item">
                    <div class="module-info">
                        <h5>${module.title}</h5>
                        <div class="module-meta">
                            <span>Order: ${module.module_order}</span>
                            <span>Duration: ${module.duration || 'N/A'}</span>
                            <span>Tier: ${module.required_tier}</span>
                            ${module.is_premium ? '<span class="course-tier">PREMIUM</span>' : ''}
                        </div>
                        <p style="color: #ccc; margin-top: 0.5rem; font-size: 0.9rem;">${module.description}</p>
                    </div>
                    <div class="module-actions">
                        <button class="btn-small" onclick="adminPanel.openModuleModal('${this.currentCourseId}', '${module.id}')">Edit</button>
                        <button class="btn-small btn-danger" onclick="adminPanel.deleteModule('${module.id}')">Delete</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    // STUDENTS MANAGEMENT
    renderStudents() {
        const container = document.getElementById('studentsList');
        if (!container) return;

        if (this.students.length === 0) {
            container.innerHTML = `
                <div class="placeholder-message">
                    <p>No students found. Students will appear here once they sign up.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.students.map(student => {
            const createdDate = new Date(student.created_at).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
            
            const updatedDate = student.updated_at 
                ? new Date(student.updated_at).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                })
                : 'N/A';

            const tierClass = student.subscription_tier === 'premium' ? 'tier-premium' : 'tier-basic';
            const tierText = student.subscription_tier ? student.subscription_tier.toUpperCase() : 'BASIC';

            return `
                <div class="student-item">
                    <div class="student-info">
                        <h3>${student.email}</h3>
                        <div class="student-meta">
                            <span class="student-tier ${tierClass}">${tierText}</span>
                            <span>Created: ${createdDate}</span>
                            <span>Updated: ${updatedDate}</span>
                        </div>
                    </div>
                    <div class="student-actions">
                        <button class="btn-small" onclick="adminPanel.viewStudentDetails('${student.id}')">View Details</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    searchStudents(query) {
        const container = document.getElementById('studentsList');
        if (!container) return;

        if (!query.trim()) {
            this.renderStudents();
            return;
        }

        const searchTerm = query.toLowerCase();
        const filteredStudents = this.students.filter(student => 
            student.email.toLowerCase().includes(searchTerm) ||
            (student.subscription_tier && student.subscription_tier.toLowerCase().includes(searchTerm))
        );

        if (filteredStudents.length === 0) {
            container.innerHTML = `
                <div class="placeholder-message">
                    <p>No students found matching "${query}"</p>
                </div>
            `;
            return;
        }

        container.innerHTML = filteredStudents.map(student => {
            const createdDate = new Date(student.created_at).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
            
            const updatedDate = student.updated_at 
                ? new Date(student.updated_at).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                })
                : 'N/A';

            const tierClass = student.subscription_tier === 'premium' ? 'tier-premium' : 'tier-basic';
            const tierText = student.subscription_tier ? student.subscription_tier.toUpperCase() : 'BASIC';

            return `
                <div class="student-item">
                    <div class="student-info">
                        <h3>${student.email}</h3>
                        <div class="student-meta">
                            <span class="student-tier ${tierClass}">${tierText}</span>
                            <span>Created: ${createdDate}</span>
                            <span>Updated: ${updatedDate}</span>
                        </div>
                    </div>
                    <div class="student-actions">
                        <button class="btn-small" onclick="adminPanel.viewStudentDetails('${student.id}')">View Details</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    viewStudentDetails(studentId) {
        const student = this.students.find(s => s.id === studentId);
        if (!student) return;

        const createdDate = new Date(student.created_at).toLocaleString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        const updatedDate = student.updated_at 
            ? new Date(student.updated_at).toLocaleString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            })
            : 'Not updated yet';

        const detailsHTML = `
            <div style="text-align: left; line-height: 1.8;">
                <p><strong>Email:</strong> ${student.email}</p>
                <p><strong>Subscription Tier:</strong> ${student.subscription_tier || 'basic'}</p>
                <p><strong>Created:</strong> ${createdDate}</p>
                <p><strong>Last Updated:</strong> ${updatedDate}</p>
                <p><strong>User ID:</strong> ${student.id}</p>
            </div>
        `;

        document.getElementById('confirmModalTitle').textContent = 'Student Details';
        document.getElementById('confirmModalMessage').innerHTML = detailsHTML;
        
        const confirmBtn = document.getElementById('confirmActionBtn');
        confirmBtn.textContent = 'Close';
        confirmBtn.className = 'cta-button';
        confirmBtn.onclick = () => {
            this.closeConfirmModal();
        };
        
        document.getElementById('confirmModal').classList.add('active');
    }

    // MODAL MANAGEMENT
    openCourseModal(courseId = null) {
        const modal = document.getElementById('courseModal');
        const title = document.getElementById('courseModalTitle');
        const form = document.getElementById('courseForm');
        
        if (courseId) {
            // Edit mode
            const course = this.courses.find(c => c.id === courseId);
            if (course) {
                title.textContent = 'Edit Course';
                document.getElementById('courseId').value = course.id;
                document.getElementById('courseTitle').value = course.title;
                document.getElementById('courseDescription').value = course.description;
                document.getElementById('courseTier').value = course.required_tier;
                document.getElementById('coursePrice').value = course.price;
                document.getElementById('courseStatus').value = course.status;
                document.getElementById('courseActive').checked = course.is_active;
            }
        } else {
            // Create mode
            title.textContent = 'Add New Course';
            form.reset();
            document.getElementById('courseId').value = '';
            document.getElementById('courseStatus').value = 'draft';
            document.getElementById('courseTier').value = 'basic';
            document.getElementById('courseActive').checked = true;
        }
        
        modal.classList.add('active');
    }

    closeCourseModal() {
        document.getElementById('courseModal').classList.remove('active');
        document.getElementById('courseForm').reset();
    }

    openModuleModal(courseId, moduleId = null) {
        this.currentCourseId = courseId;
        const modal = document.getElementById('moduleModal');
        const title = document.getElementById('moduleModalTitle');
        const form = document.getElementById('moduleForm');
        
        document.getElementById('moduleCourseId').value = courseId;
        
        if (moduleId) {
            // Edit mode
            const module = this.modules.find(m => m.id === moduleId);
            if (module) {
                title.textContent = 'Edit Module';
                document.getElementById('moduleId').value = module.id;
                document.getElementById('moduleTitle').value = module.title;
                document.getElementById('moduleDescription').value = module.description;
                document.getElementById('moduleOrder').value = module.module_order;
                document.getElementById('moduleDuration').value = module.duration || '';
                document.getElementById('moduleVideoUrl').value = module.video_url || '';
                document.getElementById('moduleTier').value = module.required_tier;
                document.getElementById('moduleIsPremium').checked = module.is_premium;
            }
        } else {
            // Create mode
            title.textContent = 'Add New Module';
            form.reset();
            document.getElementById('moduleId').value = '';
            document.getElementById('moduleOrder').value = this.modules.length + 1;
            document.getElementById('moduleTier').value = 'basic';
            document.getElementById('moduleIsPremium').checked = false;
        }
        
        modal.classList.add('active');
    }

    closeModuleModal() {
        document.getElementById('moduleModal').classList.remove('active');
        document.getElementById('moduleForm').reset();
    }

    async viewModules(courseId) {
        this.currentCourseId = courseId;
        const course = this.courses.find(c => c.id === courseId);
        
        if (course) {
            document.getElementById('modulesViewTitle').textContent = `Modules - ${course.title}`;
            document.getElementById('modulesCourseTitle').textContent = course.title;
            document.getElementById('modulesCourseDescription').textContent = course.description;
            
            await this.loadModules(courseId);
            document.getElementById('modulesView').classList.add('active');
        }
    }

    closeModulesView() {
        document.getElementById('modulesView').classList.remove('active');
        this.currentCourseId = null;
        this.modules = [];
    }

    showConfirmModal(title, message, confirmCallback) {
        document.getElementById('confirmModalTitle').textContent = title;
        document.getElementById('confirmModalMessage').innerHTML = message;
        
        const confirmBtn = document.getElementById('confirmActionBtn');
        confirmBtn.onclick = confirmCallback;
        
        document.getElementById('confirmModal').classList.add('active');
    }

    closeConfirmModal() {
        document.getElementById('confirmModal').classList.remove('active');
    }

    renderDashboard() {
        // Dashboard is rendered on load, this can be used for dynamic updates
        console.log('Dashboard rendered');
    }

    // UTILITY METHODS
    showLoading(section) {
        let container;
        if (section === 'students') {
            container = document.getElementById('studentsList');
        } else {
            container = document.getElementById(`admin${section.charAt(0).toUpperCase() + section.slice(1)}List`);
        }
        
        if (container) {
            container.innerHTML = '<div class="loading-message">Loading...</div>';
        }
    }

    showModulesLoading() {
        const container = document.getElementById('modulesListView');
        if (container) {
            container.innerHTML = '<div class="loading-message">Loading modules...</div>';
        }
    }

    showMessage(message, type) {
        const messageEl = document.getElementById('adminMessage');
        messageEl.textContent = message;
        messageEl.className = `form-message ${type}`;
        messageEl.style.display = 'block';
        
        // Auto-hide success messages
        if (type === 'success') {
            setTimeout(() => {
                messageEl.style.display = 'none';
            }, 5000);
        }
    }

    async logout() {
        try {
            const { error } = await supabase.auth.signOut();
            if (error) throw error;
            window.location.href = 'admin-login.html';
        } catch (error) {
            console.error('Logout error:', error);
            this.showMessage('❌ Logout failed: ' + error.message, 'error');
        }
    }

    // Student management methods
    editStudent(studentId) {
        this.viewStudentDetails(studentId);
    }
}

// Global functions for navigation
function showSection(sectionId) {
    // Hide all sections
    document.querySelectorAll('.admin-section').forEach(section => {
        section.style.display = 'none';
    });
    
    // Show selected section
    document.getElementById(sectionId).style.display = 'block';
    
    // Update active state in navigation
    document.querySelectorAll('.nav-links a').forEach(link => {
        link.classList.remove('active');
    });
    
    // Update URL hash
    window.location.hash = sectionId;
}

// Initialize admin panel when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Supabase Configuration
    const SUPABASE_URL = 'https://dawxhfdvozykhxkzpfbv.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhd3hoZmR2b3p5a2h4a3pwZmJ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1MTgyMzAsImV4cCI6MjA5OTA5NDIzMH0.MiGLrpu3i-5u9hyQrdyBFm9J5pb689Oe21eUsKUjbyU';

    // Initialize Supabase
    window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    
    // Initialize Admin Panel
    window.adminPanel = new AdminPanel();
});
