/**
 * EKAGRA — Authentication Client Engine
 * Handles background video, form validations, API interactions, and user feedback.
 */

document.addEventListener('DOMContentLoaded', () => {
  initAuthBackgroundVideo();
  initPasswordToggles();
  initLoginForm();
  initSignupForm();
  initForgotPasswordForm();
  initResetPasswordForm();
  initAuthSwitchLinks();
  initAuthSessionCheck();
});

// 2. Password Visibility Toggles
function initPasswordToggles() {
  const toggleBtns = document.querySelectorAll('.pwd-toggle-btn');
  toggleBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (!input) return;

      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';

      // Update icon
      btn.innerHTML = isPassword
        ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`
        : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
    });
  });
}

// Helper: Show Feedback (Error / Success)
function showFeedback(bannerId, message, type = 'error') {
  const banner = document.getElementById(bannerId);
  if (!banner) return;

  banner.className = `feedback-banner show ${type}`;
  banner.textContent = message;
}

function clearFeedback(bannerId) {
  const banner = document.getElementById(bannerId);
  if (!banner) return;
  banner.className = 'feedback-banner';
  banner.textContent = '';
}

// Helper: Set Button Loading State
function setButtonLoading(button, isLoading, loadingText = 'Processing...', originalText = 'Submit') {
  if (!button) return;
  if (isLoading) {
    button.disabled = true;
    button.setAttribute('data-original-text', originalText);
    button.innerHTML = `<span class="spinner"></span> <span>${loadingText}</span>`;
  } else {
    button.disabled = false;
    const text = button.getAttribute('data-original-text') || originalText;
    button.innerHTML = text;
  }
}

// 3. Login Form
function initLoginForm() {
  const form = document.getElementById('loginForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFeedback('loginFeedback');

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const submitBtn = document.getElementById('loginSubmitBtn');

    if (!email || !password) {
      showFeedback('loginFeedback', 'Please enter your email and password.', 'error');
      return;
    }

    setButtonLoading(submitBtn, true, 'Signing in...', 'Sign In');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to sign in.');
      }

      // Clear any prior cached dashboard snapshots before entering dashboard as new user
      try {
        const localKeys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && (k.startsWith('ekagra_cache_') || k === 'ekagra_last_uid')) localKeys.push(k);
        }
        localKeys.forEach((k) => localStorage.removeItem(k));
        const sessionKeys = [];
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (k && (k.startsWith('ekagra_cache_') || k === 'ekagra_last_uid')) sessionKeys.push(k);
        }
        sessionKeys.forEach((k) => sessionStorage.removeItem(k));
      } catch (e) {}

      // Success: redirect to dashboard replacing login in history
      window.location.replace('/dashboard');
    } catch (err) {
      showFeedback('loginFeedback', err.message, 'error');
      setButtonLoading(submitBtn, false, '', 'Sign In');
    }
  });
}

// 4. Sign Up Form
function initSignupForm() {
  const form = document.getElementById('signupForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFeedback('signupFeedback');

    const name = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const submitBtn = document.getElementById('signupSubmitBtn');

    if (!name || name.length < 2) {
      showFeedback('signupFeedback', 'Please enter your full name (at least 2 characters).', 'error');
      return;
    }

    if (!email) {
      showFeedback('signupFeedback', 'Please enter a valid email.', 'error');
      return;
    }

    if (!password || password.length < 8) {
      showFeedback('signupFeedback', 'Password must be at least 8 characters.', 'error');
      return;
    }

    if (password !== confirmPassword) {
      showFeedback('signupFeedback', 'Passwords do not match.', 'error');
      return;
    }

    setButtonLoading(submitBtn, true, 'Creating account...', 'Create Account');

    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, confirmPassword }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create account.');
      }

      // Clear any prior cached dashboard snapshots before entering dashboard as new user
      try {
        const localKeys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && (k.startsWith('ekagra_cache_') || k === 'ekagra_last_uid')) localKeys.push(k);
        }
        localKeys.forEach((k) => localStorage.removeItem(k));
        const sessionKeys = [];
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (k && (k.startsWith('ekagra_cache_') || k === 'ekagra_last_uid')) sessionKeys.push(k);
        }
        sessionKeys.forEach((k) => sessionStorage.removeItem(k));
      } catch (e) {}

      // Success: redirect to dashboard replacing login in history
      window.location.replace('/dashboard');
    } catch (err) {
      showFeedback('signupFeedback', err.message, 'error');
      setButtonLoading(submitBtn, false, '', 'Create Account');
    }
  });
}

// 5. Forgot Password Form
function initForgotPasswordForm() {
  const form = document.getElementById('forgotPasswordForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFeedback('forgotFeedback');

    const email = document.getElementById('email').value.trim();
    const submitBtn = document.getElementById('forgotSubmitBtn');

    if (!email) {
      showFeedback('forgotFeedback', 'Please enter your email.', 'error');
      return;
    }

    setButtonLoading(submitBtn, true, 'Sending link...', 'Send Reset Link');

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Unable to request password reset.');
      }

      // Generic success message
      showFeedback(
        'forgotFeedback',
        data.message || 'If an account exists for this email, a password reset link has been sent.',
        'success'
      );

      // Disable input and button after success
      document.getElementById('email').disabled = true;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Link Sent';
    } catch (err) {
      showFeedback('forgotFeedback', err.message, 'error');
      setButtonLoading(submitBtn, false, '', 'Send Reset Link');
    }
  });
}

// 6. Reset Password Form
function initResetPasswordForm() {
  const form = document.getElementById('resetPasswordForm');
  if (!form) return;

  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');

  if (!token) {
    showFeedback('resetFeedback', 'Invalid reset link. Token is missing.', 'error');
    const submitBtn = document.getElementById('resetSubmitBtn');
    if (submitBtn) submitBtn.disabled = true;
    return;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFeedback('resetFeedback');

    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const submitBtn = document.getElementById('resetSubmitBtn');

    if (!newPassword || newPassword.length < 8) {
      showFeedback('resetFeedback', 'Password must be at least 8 characters.', 'error');
      return;
    }

    if (newPassword !== confirmPassword) {
      showFeedback('resetFeedback', 'Passwords do not match.', 'error');
      return;
    }

    setButtonLoading(submitBtn, true, 'Resetting password...', 'Reset Password');

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword, confirmPassword }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to reset password.');
      }

      // Success state
      showFeedback('resetFeedback', 'Password reset successfully.', 'success');

      // Replace form with continue button
      const container = document.getElementById('resetFormContainer');
      if (container) {
        container.innerHTML = `
          <div style="text-align: center; margin-top: 12px;">
            <a href="/login" class="btn-auth-primary" style="text-decoration: none; display: inline-flex;">
              Continue to Sign In
            </a>
          </div>
        `;
      }
    } catch (err) {
      showFeedback('resetFeedback', err.message, 'error');
      setButtonLoading(submitBtn, false, '', 'Reset Password');
    }
  });
}

// 6. Seamless Navigation Between Login & Signup Without History Stacking
function initAuthSwitchLinks() {
  const switchLinks = document.querySelectorAll('.auth-switch-text a');
  switchLinks.forEach((link) => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      if (href && (href.startsWith('/login') || href.startsWith('/signup'))) {
        e.preventDefault();
        window.location.replace(href);
      }
    });
  });
}

// 7. Check Active Session on Auth Pages & Handle Browser Back
function initAuthSessionCheck() {
  const checkSession = async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        if (data && data.user) {
          // If already authenticated and visiting /login or /signup, redirect to landing page
          window.location.replace('/');
        }
      }
    } catch (e) {
      // Unauthenticated or network error, safely stay on auth page
    }
  };

  // Run on page load
  checkSession();

  // Run on bfcache navigation (e.g., browser Back button pressed)
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      checkSession();
    }
  });
}

// 8. Continuous Slow-Motion Auth Background Video
function initAuthBackgroundVideo() {
  const video = document.getElementById('authBgVideo');
  if (!video) return;

  const configureAndPlay = () => {
    try {
      video.muted = true;
      video.loop = true;
      video.defaultPlaybackRate = 0.7;
      video.playbackRate = 0.7;
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // Retry muted autoplay
          video.muted = true;
          video.play().catch(() => {});
        });
      }
    } catch (e) {}
  };

  video.addEventListener('loadedmetadata', configureAndPlay);
  video.addEventListener('play', () => {
    if (video.playbackRate !== 0.7) {
      video.playbackRate = 0.7;
    }
  });

  // Ensure continuous playback on tab switch or bfcache restore
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      configureAndPlay();
    }
  });

  window.addEventListener('pageshow', () => {
    configureAndPlay();
  });

  // Initial playback setup
  configureAndPlay();
}
