// Login Page JavaScript
document.addEventListener('DOMContentLoaded', function() {

    // Admin credentials (change these to your desired credentials)
    const ADMIN_EMAIL = 'lguluisiana_hrmo@yahoo.com';
    const ADMIN_PASSWORD = 'admin123';

    // Get DOM elements
    const loginForm = document.getElementById('loginForm');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const togglePassword = document.getElementById('togglePassword');
    const errorMessageDiv = document.getElementById('errorMessage');
    const errorText = document.getElementById('errorText');

    // Toggle password visibility
    if (togglePassword) {
        togglePassword.addEventListener('click', function() {
            const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordInput.setAttribute('type', type);
            this.classList.toggle('fa-eye');
            this.classList.toggle('fa-eye-slash');
        });
    }

    // Show error message
    function showError(message) {
        errorText.textContent = message;
        errorMessageDiv.style.display = 'block';

        // Auto-hide after 3 seconds
        setTimeout(() => {
            errorMessageDiv.style.opacity = '0';
            setTimeout(() => {
                errorMessageDiv.style.display = 'none';
                errorMessageDiv.style.opacity = '1';
            }, 300);
        }, 3000);
    }

    // Hide error message
    function hideError() {
        errorMessageDiv.style.display = 'none';
    }

    // Clear error when typing
    if (emailInput) {
        emailInput.addEventListener('input', hideError);
    }
    if (passwordInput) {
        passwordInput.addEventListener('input', hideError);
    }

    // Handle form submission
    if (loginForm) {
        loginForm.addEventListener('submit', function(event) {
            event.preventDefault();

            const email = emailInput ? emailInput.value.trim() : '';
            const password = passwordInput ? passwordInput.value.trim() : '';

            // Basic validation
            if (!email || !password) {
                showError('Please enter both email and password');
                return;
            }

            // Email format validation
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                showError('Please enter a valid email address');
                return;
            }

            // Check credentials
            if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
                // Store login state in sessionStorage
                sessionStorage.setItem('isAdminLoggedIn', 'true');
                sessionStorage.setItem('adminEmail', email);
                sessionStorage.setItem('loginTime', new Date().toISOString());

                // Redirect to dashboard
                window.location.href = 'html/dashboard.html';
            } else {
                showError('Invalid email or password. Please try again.');
                if (passwordInput) {
                    passwordInput.value = '';
                    passwordInput.focus();
                }
            }
        });
    }

    // Check if already logged in (optional - uncomment to auto-redirect)
    if (sessionStorage.getItem('isAdminLoggedIn') === 'true') {
        const loginTime = sessionStorage.getItem('loginTime');
        if (loginTime) {
            const hoursSinceLogin = (new Date() - new Date(loginTime)) / (1000 * 60 * 60);
            // If less than 8 hours, redirect to dashboard
            if (hoursSinceLogin < 8) {
                // window.location.href = 'html/dashboard.html';
            }
        }
    }
});