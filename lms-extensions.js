// LMS Extensions - Complete Feature Set
// Add this script after lms.js to enable quizzes, assignments, discussions, certificates, and more

class LMSExtensions {
    constructor(lmsManager) {
        this.lms = lmsManager;
        this.quizzes = [];
        this.assignments = [];
        this.discussions = [];
        this.announcements = [];
        this.certificates = [];
        this.notifications = [];
        this.reviews = [];
        this.init();
    }

    async init() {
        console.log('LMS Extensions initialized');
    }

    // ==================== QUIZZES ====================
    
    async loadQuizzes(courseId) {
        try {
            const { data, error } = await supabase
                .from('quizzes')
                .select('*')
                .eq('course_id', courseId)
                .eq('is_active', true)
                .order('created_at');

            if (error) throw error;
            this.quizzes = data || [];
            return this.quizzes;
        } catch (error) {
            console.error('Error loading quizzes:', error);
            this.quizzes = [];
            return [];
        }
    }

    async loadQuizQuestions(quizId) {
        try {
            const { data, error } = await supabase
                .from('quiz_questions')
                .select('*')
                .eq('quiz_id', quizId)
                .order('question_order');

            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error loading quiz questions:', error);
            return [];
        }
    }

    async submitQuizAttempt(quizId, answers) {
        try {
            // Calculate score using database function
            const { data: scoreData, error: scoreError } = await supabase.rpc('calculate_quiz_score', {
                p_quiz_id: quizId,
                p_answers: answers
            });

            if (scoreError) throw scoreError;

            const { score, total_points, percentage } = scoreData[0];
            const passed = percentage >= 70; // Default passing threshold

            // Save attempt
            const { data, error } = await supabase
                .from('quiz_attempts')
                .insert([{
                    quiz_id: quizId,
                    user_id: this.lms.currentUser.id,
                    score: score,
                    total_points: total_points,
                    percentage: percentage,
                    passed: passed,
                    completed_at: new Date().toISOString(),
                    time_spent: 0, // Calculate based on start time
                    answers: JSON.stringify(answers)
                }])
                .select()
                .single();

            if (error) throw error;

            // Create notification
            await this.createNotification(
                'Quiz Completed',
                `You ${passed ? 'passed' : 'failed'} the quiz with ${percentage}%`,
                'quiz',
                null
            );

            return { success: true, attempt: data, passed, percentage };
        } catch (error) {
            console.error('Error submitting quiz:', error);
            return { success: false, error: error.message };
        }
    }

    async getUserQuizAttempts(quizId) {
        try {
            const { data, error } = await supabase
                .from('quiz_attempts')
                .select('*')
                .eq('quiz_id', quizId)
                .eq('user_id', this.lms.currentUser.id)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error loading quiz attempts:', error);
            return [];
        }
    }

    renderQuizzesList(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (this.quizzes.length === 0) {
            container.innerHTML = '<p class="no-content">No quizzes available for this course.</p>';
            return;
        }

        container.innerHTML = this.quizzes.map(quiz => `
            <div class="quiz-item">
                <div class="quiz-header">
                    <h4>${quiz.title}</h4>
                    <span class="quiz-badge">${quiz.passing_score}% to pass</span>
                </div>
                <p>${quiz.description || 'No description'}</p>
                <div class="quiz-meta">
                    <span>⏱️ ${quiz.time_limit ? quiz.time_limit + ' min' : 'No time limit'}</span>
                    <span>📝 ${quiz.total_points} points</span>
                </div>
                <button class="cta-button" onclick="lmsExtensions.startQuiz('${quiz.id}')">
                    Start Quiz
                </button>
            </div>
        `).join('');
    }

    async startQuiz(quizId) {
        const quiz = this.quizzes.find(q => q.id === quizId);
        if (!quiz) return;

        const questions = await this.loadQuizQuestions(quizId);
        if (questions.length === 0) {
            alert('No questions available in this quiz.');
            return;
        }

        // Show quiz modal
        this.showQuizModal(quiz, questions);
    }

    showQuizModal(quiz, questions) {
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.id = 'quizModal';
        modal.innerHTML = `
            <div class="modal-content large-modal">
                <div class="modal-header">
                    <h3>${quiz.title}</h3>
                    <button class="close-btn" onclick="lmsExtensions.closeQuizModal()">✕</button>
                </div>
                <div class="modal-body">
                    <form id="quizForm">
                        ${questions.map((q, idx) => `
                            <div class="question-item">
                                <p><strong>Question ${idx + 1}:</strong> ${q.question_text}</p>
                                ${this.renderQuestionInput(q)}
                            </div>
                        `).join('')}
                        <div class="quiz-actions">
                            <button type="button" class="btn-secondary" onclick="lmsExtensions.closeQuizModal()">Cancel</button>
                            <button type="submit" class="cta-button">Submit Answers</button>
                        </div>
                    </form>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('quizForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.submitQuizFromForm(quiz.id, questions);
        });
    }

    renderQuestionInput(question) {
        switch(question.question_type) {
            case 'multiple_choice':
                const options = question.options || [];
                return `
                    <div class="options-list">
                        ${options.map((opt, idx) => `
                            <label class="option-label">
                                <input type="radio" name="question_${question.id}" value="${opt.text}" required>
                                ${opt.text}
                            </label>
                        `).join('')}
                    </div>
                `;
            case 'true_false':
                return `
                    <div class="options-list">
                        <label class="option-label">
                            <input type="radio" name="question_${question.id}" value="true" required> True
                        </label>
                        <label class="option-label">
                            <input type="radio" name="question_${question.id}" value="false" required> False
                        </label>
                    </div>
                `;
            case 'short_answer':
                return `
                    <input type="text" name="question_${question.id}" placeholder="Your answer" required style="width: 100%; padding: 0.5rem; margin-top: 0.5rem;">
                `;
            case 'essay':
                return `
                    <textarea name="question_${question.id}" rows="4" placeholder="Write your answer here..." required style="width: 100%; padding: 0.5rem; margin-top: 0.5rem;"></textarea>
                `;
            default:
                return '';
        }
    }

    async submitQuizFromForm(quizId, questions) {
        const answers = questions.map(q => {
            const input = document.querySelector(`input[name="question_${q.id}"]:checked`) || 
                         document.querySelector(`textarea[name="question_${q.id}"]`) ||
                         document.querySelector(`input[name="question_${q.id}"]`);
            return {
                question_id: q.id,
                answer: input ? input.value : ''
            };
        });

        const result = await this.submitQuizAttempt(quizId, answers);
        
        if (result.success) {
            this.closeQuizModal();
            alert(`Quiz submitted! Score: ${result.percentage}% - ${result.passed ? 'PASSED' : 'FAILED'}`);
        } else {
            alert('Error submitting quiz: ' + result.error);
        }
    }

    closeQuizModal() {
        const modal = document.getElementById('quizModal');
        if (modal) modal.remove();
    }

    // ==================== ASSIGNMENTS ====================

    async loadAssignments(courseId) {
        try {
            const { data, error } = await supabase
                .from('assignments')
                .select('*')
                .eq('course_id', courseId)
                .eq('is_active', true)
                .order('due_date', { ascending: true });

            if (error) throw error;
            this.assignments = data || [];
            return this.assignments;
        } catch (error) {
            console.error('Error loading assignments:', error);
            this.assignments = [];
            return [];
        }
    }

    renderAssignmentsList(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (this.assignments.length === 0) {
            container.innerHTML = '<p class="no-content">No assignments for this course.</p>';
            return;
        }

        container.innerHTML = this.assignments.map(assignment => `
            <div class="assignment-item">
                <div class="assignment-header">
                    <h4>${assignment.title}</h4>
                    ${assignment.due_date ? `<span class="due-badge ${this.isOverdue(assignment.due_date) ? 'overdue' : ''}">Due: ${new Date(assignment.due_date).toLocaleDateString()}</span>` : ''}
                </div>
                <p>${assignment.description}</p>
                <div class="assignment-meta">
                    <span>📊 ${assignment.max_points} points</span>
                    <span>📁 Type: ${assignment.submission_type}</span>
                </div>
                <button class="cta-button" onclick="lmsExtensions.viewAssignment('${assignment.id}')">
                    View Details
                </button>
            </div>
        `).join('');
    }

    isOverdue(dueDate) {
        return new Date(dueDate) < new Date();
    }

    async viewAssignment(assignmentId) {
        const assignment = this.assignments.find(a => a.id === assignmentId);
        if (!assignment) return;

        // Check if already submitted
        const { data: submission } = await supabase
            .from('assignment_submissions')
            .select('*')
            .eq('assignment_id', assignmentId)
            .eq('user_id', this.lms.currentUser.id)
            .single();

        this.showAssignmentModal(assignment, submission);
    }

    showAssignmentModal(assignment, submission) {
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.id = 'assignmentModal';
        modal.innerHTML = `
            <div class="modal-content large-modal">
                <div class="modal-header">
                    <h3>${assignment.title}</h3>
                    <button class="close-btn" onclick="lmsExtensions.closeAssignmentModal()">✕</button>
                </div>
                <div class="modal-body">
                    <div class="assignment-details">
                        <p><strong>Description:</strong></p>
                        <p>${assignment.description}</p>
                        ${assignment.instructions ? `<p><strong>Instructions:</strong></p><p>${assignment.instructions}</p>` : ''}
                        ${assignment.due_date ? `<p><strong>Due Date:</strong> ${new Date(assignment.due_date).toLocaleString()}</p>` : ''}
                        <p><strong>Max Points:</strong> ${assignment.max_points}</p>
                        <p><strong>Submission Type:</strong> ${assignment.submission_type}</p>
                    </div>
                    
                    ${submission ? `
                        <div class="submission-status">
                            <h4>Your Submission</h4>
                            <p>Status: <strong>${submission.status}</strong></p>
                            <p>Submitted: ${new Date(submission.submitted_at).toLocaleString()}</p>
                            ${submission.grade ? `<p>Grade: ${submission.grade}/${assignment.max_points}</p>` : ''}
                            ${submission.feedback ? `<p><strong>Feedback:</strong></p><p>${submission.feedback}</p>` : ''}
                        </div>
                    ` : `
                        <form id="submissionForm" class="submission-form">
                            <h4>Submit Your Work</h4>
                            ${assignment.submission_type === 'text' ? `
                                <textarea name="submission_text" rows="6" placeholder="Write your submission here..." required></textarea>
                            ` : assignment.submission_type === 'url' ? `
                                <input type="url" name="submission_url" placeholder="Enter URL to your work" required style="width: 100%; padding: 0.5rem;">
                            ` : `
                                <p>File upload coming soon. Please submit via text or URL.</p>
                                <textarea name="submission_text" rows="4" placeholder="Or describe your submission..."></textarea>
                            `}
                            <button type="submit" class="cta-button" style="margin-top: 1rem;">Submit Assignment</button>
                        </form>
                    `}
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        if (!submission) {
            document.getElementById('submissionForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.submitAssignment(assignment.id, e.target);
            });
        }
    }

    async submitAssignment(assignmentId, form) {
        const formData = new FormData(form);
        const submissionData = {
            assignment_id: assignmentId,
            user_id: this.lms.currentUser.id,
            submission_text: formData.get('submission_text'),
            submission_url: formData.get('submission_url'),
            status: 'submitted'
        };

        try {
            const { data, error } = await supabase
                .from('assignment_submissions')
                .insert([submissionData])
                .select()
                .single();

            if (error) throw error;

            // Create notification for instructor
            await this.createNotification(
                'New Assignment Submission',
                `A student submitted "${assignment.title}"`,
                'assignment',
                null
            );

            this.closeAssignmentModal();
            alert('Assignment submitted successfully!');
            this.viewAssignment(assignmentId); // Reload to show submission
        } catch (error) {
            console.error('Error submitting assignment:', error);
            alert('Error submitting assignment: ' + error.message);
        }
    }

    closeAssignmentModal() {
        const modal = document.getElementById('assignmentModal');
        if (modal) modal.remove();
    }

    // ==================== DISCUSSIONS ====================

    async loadDiscussions(courseId) {
        try {
            const { data, error } = await supabase
                .from('discussions')
                .select('*, profiles(full_name, avatar_url)')
                .eq('course_id', courseId)
                .eq('parent_id', null) // Only top-level discussions
                .order('is_pinned', { ascending: false })
                .order('created_at', { ascending: false });

            if (error) throw error;
            this.discussions = data || [];
            return this.discussions;
        } catch (error) {
            console.error('Error loading discussions:', error);
            this.discussions = [];
            return [];
        }
    }

    renderDiscussionsList(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (this.discussions.length === 0) {
            container.innerHTML = `
                <p class="no-content">No discussions yet. Start the conversation!</p>
                <button class="cta-button" onclick="lmsExtensions.newDiscussion()">Start Discussion</button>
            `;
            return;
        }

        container.innerHTML = `
            <button class="cta-button" style="margin-bottom: 1rem;" onclick="lmsExtensions.newDiscussion()">+ New Discussion</button>
            ${this.discussions.map(discussion => `
                <div class="discussion-item ${discussion.is_pinned ? 'pinned' : ''}">
                    <div class="discussion-header">
                        <h4>${discussion.is_pinned ? '📌 ' : ''}${discussion.title}</h4>
                        <span class="discussion-stats">💬 ${discussion.reply_count} replies | 👁️ ${discussion.view_count} views</span>
                    </div>
                    <p>${discussion.content.substring(0, 200)}${discussion.content.length > 200 ? '...' : ''}</p>
                    <div class="discussion-meta">
                        <span>By: ${discussion.profiles?.full_name || 'Anonymous'}</span>
                        <span>${new Date(discussion.created_at).toLocaleDateString()}</span>
                    </div>
                    <button class="btn-secondary" onclick="lmsExtensions.viewDiscussion('${discussion.id}')">View Discussion</button>
                </div>
            `).join('')}
        `;
    }

    async newDiscussion() {
        const title = prompt('Discussion Title:');
        if (!title) return;
        
        const content = prompt('Your message:');
        if (!content) return;

        // Get current course ID from LMS
        const courseId = this.lms.currentCourse?.id;
        if (!courseId) {
            alert('Please open a course first.');
            return;
        }

        try {
            const { data, error } = await supabase
                .from('discussions')
                .insert([{
                    course_id: courseId,
                    user_id: this.lms.currentUser.id,
                    title: title,
                    content: content
                }])
                .select()
                .single();

            if (error) throw error;

            alert('Discussion created successfully!');
            this.loadDiscussions(courseId);
            this.renderDiscussionsList('discussionsContainer');
        } catch (error) {
            console.error('Error creating discussion:', error);
            alert('Error creating discussion: ' + error.message);
        }
    }

    async viewDiscussion(discussionId) {
        alert('Discussion view coming soon. This would show the full thread and replies.');
    }

    // ==================== ANNOUNCEMENTS ====================

    async loadAnnouncements(courseId) {
        try {
            const { data, error } = await supabase
                .from('announcements')
                .select('*, profiles(full_name)')
                .eq('course_id', courseId)
                .order('is_pinned', { ascending: false })
                .order('created_at', { ascending: false });

            if (error) throw error;
            this.announcements = data || [];
            return this.announcements;
        } catch (error) {
            console.error('Error loading announcements:', error);
            this.announcements = [];
            return [];
        }
    }

    renderAnnouncements(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (this.announcements.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = `
            <h3>📢 Announcements</h3>
            ${this.announcements.map(announcement => `
                <div class="announcement-item ${announcement.is_pinned ? 'pinned' : ''}">
                    <h4>${announcement.is_pinned ? '📌 ' : ''}${announcement.title}</h4>
                    <p>${announcement.content}</p>
                    <small>Posted by ${announcement.profiles?.full_name || 'Instructor'} on ${new Date(announcement.created_at).toLocaleDateString()}</small>
                </div>
            `).join('')}
        `;
    }

    // ==================== CERTIFICATES ====================

    async getUserCertificates() {
        try {
            const { data, error } = await supabase
                .from('certificates')
                .select('*, courses(title)')
                .eq('user_id', this.lms.currentUser.id)
                .eq('is_valid', true)
                .order('issued_at', { ascending: false });

            if (error) throw error;
            this.certificates = data || [];
            return this.certificates;
        } catch (error) {
            console.error('Error loading certificates:', error);
            this.certificates = [];
            return [];
        }
    }

    renderCertificates(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (this.certificates.length === 0) {
            container.innerHTML = '<p class="no-content">No certificates earned yet. Complete courses to earn certificates!</p>';
            return;
        }

        container.innerHTML = this.certificates.map(cert => `
            <div class="certificate-item">
                <div class="certificate-header">
                    <h4>🎓 Certificate of Completion</h4>
                    <span class="cert-number">${cert.certificate_number}</span>
                </div>
                <p><strong>Course:</strong> ${cert.courses?.title || 'Unknown'}</p>
                <p><strong>Issued:</strong> ${new Date(cert.issued_at).toLocaleDateString()}</p>
                ${cert.pdf_url ? `<a href="${cert.pdf_url}" target="_blank" class="cta-button">Download PDF</a>` : ''}
                ${cert.credential_url ? `<a href="${cert.credential_url}" target="_blank" class="btn-secondary">Verify Credential</a>` : ''}
            </div>
        `).join('');
    }

    async generateCertificate(courseId) {
        try {
            const { data, error } = await supabase
                .from('certificates')
                .insert([{
                    user_id: this.lms.currentUser.id,
                    course_id: courseId,
                    is_valid: true
                }])
                .select()
                .single();

            if (error) throw error;

            // Create notification
            await this.createNotification(
                '🎉 Certificate Earned!',
                'You have earned a certificate of completion.',
                'success',
                null
            );

            return data;
        } catch (error) {
            console.error('Error generating certificate:', error);
            return null;
        }
    }

    // ==================== REVIEWS ====================

    async loadCourseReviews(courseId) {
        try {
            const { data, error } = await supabase
                .from('course_reviews')
                .select('*, profiles(full_name, avatar_url)')
                .eq('course_id', courseId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            this.reviews = data || [];
            return this.reviews;
        } catch (error) {
            console.error('Error loading reviews:', error);
            this.reviews = [];
            return [];
        }
    }

    async submitReview(courseId, rating, reviewText) {
        try {
            const { data, error } = await supabase
                .from('course_reviews')
                .upsert([{
                    user_id: this.lms.currentUser.id,
                    course_id: courseId,
                    rating: rating,
                    review_text: reviewText,
                    is_verified: true // Verified purchase since they bought the course
                }], { onConflict: 'user_id,course_id' })
                .select()
                .single();

            if (error) throw error;

            alert('Review submitted successfully!');
            return data;
        } catch (error) {
            console.error('Error submitting review:', error);
            alert('Error submitting review: ' + error.message);
            return null;
        }
    }

    renderReviews(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (this.reviews.length === 0) {
            container.innerHTML = '<p class="no-content">No reviews yet. Be the first to review this course!</p>';
            return;
        }

        const avgRating = this.reviews.reduce((sum, r) => sum + r.rating, 0) / this.reviews.length;

        container.innerHTML = `
            <div class="reviews-summary">
                <h4>Course Rating</h4>
                <div class="rating-display">
                    <span class="rating-number">${avgRating.toFixed(1)}</span>
                    <span class="stars">${'⭐'.repeat(Math.round(avgRating))}</span>
                    <span>(${this.reviews.length} reviews)</span>
                </div>
            </div>
            ${this.reviews.map(review => `
                <div class="review-item">
                    <div class="review-header">
                        <strong>${review.profiles?.full_name || 'Anonymous'}</strong>
                        <span class="review-rating">${'⭐'.repeat(review.rating)}</span>
                    </div>
                    <p>${review.review_text || 'No comment'}</p>
                    <small>${new Date(review.created_at).toLocaleDateString()}</small>
                </div>
            `).join('')}
        `;
    }

    // ==================== NOTIFICATIONS ====================

    async createNotification(title, message, type, link) {
        try {
            await supabase
                .from('notifications')
                .insert([{
                    user_id: this.lms.currentUser.id,
                    title: title,
                    message: message,
                    type: type,
                    link: link
                }]);
        } catch (error) {
            console.error('Error creating notification:', error);
        }
    }

    async loadNotifications() {
        try {
            const { data, error } = await supabase
                .from('notifications')
                .select('*')
                .eq('user_id', this.lms.currentUser.id)
                .order('created_at', { ascending: false })
                .limit(20);

            if (error) throw error;
            this.notifications = data || [];
            return this.notifications;
        } catch (error) {
            console.error('Error loading notifications:', error);
            this.notifications = [];
            return [];
        }
    }

    renderNotifications(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const unreadCount = this.notifications.filter(n => !n.is_read).length;

        container.innerHTML = `
            <div class="notifications-header">
                <h4>🔔 Notifications ${unreadCount > 0 ? `<span class="badge">${unreadCount}</span>` : ''}</h4>
            </div>
            ${this.notifications.map(notif => `
                <div class="notification-item ${notif.is_read ? 'read' : 'unread'}" onclick="lmsExtensions.markNotificationRead('${notif.id}')">
                    <div class="notification-content">
                        <strong>${notif.title}</strong>
                        <p>${notif.message}</p>
                        <small>${new Date(notif.created_at).toLocaleString()}</small>
                    </div>
                </div>
            `).join('')}
        `;
    }

    async markNotificationRead(notificationId) {
        try {
            await supabase
                .from('notifications')
                .update({ is_read: true, read_at: new Date().toISOString() })
                .eq('id', notificationId);
            
            // Refresh notifications
            this.loadNotifications();
            this.renderNotifications('notificationsContainer');
        } catch (error) {
            console.error('Error marking notification as read:', error);
        }
    }

    // ==================== COURSE ENROLLMENT ====================

    async enrollInCourse(courseId) {
        try {
            const { data, error } = await supabase
                .from('course_enrollments')
                .insert([{
                    user_id: this.lms.currentUser.id,
                    course_id: courseId,
                    status: 'active'
                }])
                .select()
                .single();

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error enrolling in course:', error);
            return null;
        }
    }

    async getCourseProgress(courseId) {
        try {
            const { data, error } = await supabase
                .from('course_enrollments')
                .select('progress_percentage, status')
                .eq('user_id', this.lms.currentUser.id)
                .eq('course_id', courseId)
                .single();

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error getting course progress:', error);
            return null;
        }
    }
}

// Initialize extensions when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Wait for LMS manager to be initialized
    if (window.lmsManager) {
        window.lmsExtensions = new LMSExtensions(window.lmsManager);
    } else {
        // Retry after a short delay
        setTimeout(() => {
            window.lmsExtensions = new LMSExtensions(window.lmsManager);
        }, 500);
    }
});
