const nodemailer = require('nodemailer');

class EmailConfigurationError extends Error {
  constructor({ missingKeys = [], invalidKeys = [] } = {}) {
    const details = [
      missingKeys.length ? `Missing SMTP env keys: ${missingKeys.join(', ')}` : '',
      invalidKeys.length ? `Invalid SMTP env keys: ${invalidKeys.join(', ')}` : '',
    ].filter(Boolean).join('. ');
    super(`Email service is not configured${details ? `. ${details}` : ''}`);
    this.name = 'EmailConfigurationError';
    this.missingKeys = missingKeys;
    this.invalidKeys = invalidKeys;
  }
}

const appName = process.env.APP_NAME || 'Exampo';

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const smtpConfig = () => {
  const host = String(process.env.SMTP_HOST || '').trim();
  const portValue = String(process.env.SMTP_PORT || '').trim();
  const port = Number(portValue);
  const secure = String(process.env.SMTP_SECURE || 'false').trim().toLowerCase() === 'true';
  const smtpUser = String(process.env.SMTP_USER || process.env.EMAIL_USER || '').trim();
  const smtpPass = String(process.env.SMTP_PASS || process.env.EMAIL_PASS || '').replace(/\s/g, '');
  const smtpFrom = String(process.env.SMTP_FROM || process.env.EMAIL_FROM || smtpUser || '').trim();
  const missingKeys = [];
  const invalidKeys = [];

  if (!host) missingKeys.push('SMTP_HOST');
  if (!portValue) missingKeys.push('SMTP_PORT');
  if (!smtpUser) missingKeys.push('SMTP_USER or EMAIL_USER');
  if (!smtpPass) missingKeys.push('SMTP_PASS or EMAIL_PASS');
  if (!smtpFrom) missingKeys.push('SMTP_FROM or EMAIL_FROM');
  if (portValue && (!Number.isInteger(port) || port < 1 || port > 65535)) invalidKeys.push('SMTP_PORT');

  if (missingKeys.length || invalidKeys.length) throw new EmailConfigurationError({ missingKeys, invalidKeys });
  return { host, port, secure, user: smtpUser, pass: smtpPass, from: smtpFrom };
};

let transporter;

const getTransporter = () => {
  const config = smtpConfig();
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass,
      },
    });
  }
  return { transporter, from: config.from };
};

const otpTemplate = ({ title, intro, otp, expiresInMinutes }) => {
  const safeTitle = escapeHtml(title);
  const safeIntro = escapeHtml(intro);
  const safeOtp = escapeHtml(otp);
  const safeAppName = escapeHtml(appName);
  const safeExpiry = escapeHtml(`${expiresInMinutes} minutes`);
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #18202f;">
      <h2 style="margin: 0 0 12px;">${safeTitle}</h2>
      <p>${safeIntro}</p>
      <p style="font-size: 28px; letter-spacing: 6px; font-weight: 700; margin: 24px 0;">${safeOtp}</p>
      <p>This code expires in ${safeExpiry}.</p>
      <p>If you did not request this code, you can safely ignore this email.</p>
      <p style="color: #5d667a;">Never share this code with anyone. ${safeAppName} support will not ask for it.</p>
    </div>
  `;
};

const sendMail = async ({ to, subject, html, text }) => {
  const config = getTransporter();
  await config.transporter.sendMail({
    from: config.from,
    to,
    subject,
    html,
    text,
  });
};

const sendSignupOtpEmail = ({ to, otp, expiresInMinutes }) => sendMail({
  to,
  subject: `Verify your ${appName} account`,
  text: `Your ${appName} verification code is ${otp}. It expires in ${expiresInMinutes} minutes. Do not share this code.`,
  html: otpTemplate({
    title: `Verify your ${appName} account`,
    intro: `Use this one-time code to verify your ${appName} account.`,
    otp,
    expiresInMinutes,
  }),
});

const sendPasswordResetOtpEmail = ({ to, otp, expiresInMinutes }) => sendMail({
  to,
  subject: `Reset your ${appName} password`,
  text: `Your ${appName} password reset code is ${otp}. It expires in ${expiresInMinutes} minutes. Do not share this code.`,
  html: otpTemplate({
    title: `Reset your ${appName} password`,
    intro: `Use this one-time code to reset your ${appName} password.`,
    otp,
    expiresInMinutes,
  }),
});

module.exports = {
  EmailConfigurationError,
  smtpConfig,
  sendSignupOtpEmail,
  sendPasswordResetOtpEmail,
  resetEmailTransporter: () => { transporter = null; },
};
