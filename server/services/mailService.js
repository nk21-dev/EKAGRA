const nodemailer = require('nodemailer');
const config = require('../config');

// In-memory capture for test verification when testing without external SMTP
let lastSentEmail = null;

function getLastSentEmail() {
  return lastSentEmail;
}

function clearLastSentEmail() {
  lastSentEmail = null;
}

function maskEmail(email) {
  if (!email || typeof email !== 'string') return 'unknown';
  const parts = email.split('@');
  if (parts.length !== 2) return '***';
  const name = parts[0];
  const domain = parts[1];
  const maskedName = name.length > 2 
    ? `${name[0]}***${name[name.length - 1]}` 
    : `${name[0]}***`;
  return `${maskedName}@${domain}`;
}

async function sendPasswordResetEmail(toEmail, resetUrl) {
  lastSentEmail = {
    to: toEmail,
    resetUrl,
    sentAt: new Date().toISOString(),
  };

  const { host, port, user, pass, from } = config.email;
  const safeRecipient = maskEmail(toEmail);

  console.log(`[MAIL] Attempting password reset email`);
  console.log(`[MAIL] SMTP host: ${host || 'not configured'}`);
  console.log(`[MAIL] SMTP port: ${port}`);
  console.log(`[MAIL] SMTP user configured: ${user ? 'yes' : 'no'}`);
  console.log(`[MAIL] SMTP password configured: ${pass ? 'yes' : 'no'}`);
  console.log(`[MAIL] From address: ${from}`);
  console.log(`[MAIL] Recipient: ${safeRecipient}`);

  // If SMTP is not fully configured (fallback in local dev mode)
  if (!host || !user || !pass) {
    console.log(`[MAIL] SMTP credentials incomplete, email delivery skipped.`);
    return { delivered: false, transport: 'none', reason: 'unconfigured' };
  }

  try {
    const isSecure = port === 465;
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: isSecure,
      auth: { user, pass },
    });

    // Verify SMTP connection
    await transporter.verify();
    console.log(`[MAIL] SMTP connection verified`);

    const mailOptions = {
      from,
      to: toEmail,
      subject: 'Reset your EKAGRA password',
      text: `Hello,\n\nA password reset was requested for your EKAGRA account.\n\nClick the link below to set a new password:\n${resetUrl}\n\nThis link expires in 1 hour and can only be used once.\n\nIf you did not request this, you can safely ignore this email.\n\n— EKAGRA Security`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; background: #0B1220; color: #E2E8F0; border-radius: 16px; border: 1px solid rgba(139, 92, 246, 0.2);">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="margin: 0; font-size: 24px; font-weight: 800; letter-spacing: 0.15em; color: #FFFFFF;">EKAGRA</h1>
            <p style="margin: 4px 0 0 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.2em; color: #94A3B8;">One Focus. Many Goals.</p>
          </div>
          <div style="background: rgba(17, 28, 46, 0.8); padding: 24px; border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.08);">
            <h2 style="margin: 0 0 12px 0; font-size: 18px; color: #FFFFFF;">Reset your password</h2>
            <p style="font-size: 14px; line-height: 1.6; color: #CBD5E1; margin: 0 0 20px 0;">
              We received a request to reset the password for your EKAGRA account. Click the button below to choose a new password:
            </p>
            <div style="text-align: center; margin: 28px 0;">
              <a href="${resetUrl}" style="background: linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%); color: #FFFFFF; text-decoration: none; padding: 12px 28px; border-radius: 9999px; font-weight: 600; font-size: 14px; display: inline-block; box-shadow: 0 4px 14px rgba(139, 92, 246, 0.35);">
                Reset Password
              </a>
            </div>
            <p style="font-size: 12px; line-height: 1.5; color: #94A3B8; margin: 0;">
              This link is secure, single-use, and expires in 1 hour.<br>
              If you didn't request a password reset, you can safely ignore this email.
            </p>
          </div>
          <p style="text-align: center; font-size: 11px; color: #64748B; margin-top: 24px;">
            © 2026 EKAGRA — Sovereign Personal Execution Engine
          </p>
        </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[MAIL] Email sent successfully`);
    console.log(`[MAIL] Resend message ID: ${info.messageId}`);
    return { delivered: true, transport: 'smtp', messageId: info.messageId };
  } catch (err) {
    console.error(`[MAIL] SMTP Error:`, err.message);
    return { delivered: false, error: err.message };
  }
}

module.exports = {
  sendPasswordResetEmail,
  getLastSentEmail,
  clearLastSentEmail,
  maskEmail,
};
