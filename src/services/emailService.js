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

class EmailAuthenticationError extends Error {
  constructor() {
    super('Email service authentication failed');
    this.name = 'EmailAuthenticationError';
  }
}

class EmailRecipientError extends Error {
  constructor() {
    super('Incorrect email address');
    this.name = 'EmailRecipientError';
  }
}

class EmailDeliveryError extends Error {
  constructor() {
    super('Unable to send OTP. Please try again.');
    this.name = 'EmailDeliveryError';
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

const isAuthenticationError = (error) => {
  const responseCode = Number(error?.responseCode || 0);
  const code = String(error?.code || '').toUpperCase();
  return code === 'EAUTH' || responseCode === 534 || responseCode === 535;
};

const isRecipientError = (error) => {
  const responseCode = Number(error?.responseCode || 0);
  const code = String(error?.code || '').toUpperCase();
  const command = String(error?.command || '').toUpperCase();
  const response = String(error?.response || error?.message || '').toLowerCase();
  if (Array.isArray(error?.rejected) && error.rejected.length > 0) return true;
  if (code === 'EENVELOPE' || command === 'RCPT TO') return true;
  if ([550, 551, 553, 554].includes(responseCode)) {
    return /recipient|mailbox|address|user|domain|unknown|invalid|not found|no such/.test(response);
  }
  return false;
};

const safeEmailErrorLog = (error) => ({
  name: error?.name,
  code: error?.code,
  command: error?.command,
  responseCode: error?.responseCode,
  missingKeys: Array.isArray(error?.missingKeys) ? error.missingKeys : undefined,
  invalidKeys: Array.isArray(error?.invalidKeys) ? error.invalidKeys : undefined,
  rejected: Array.isArray(error?.rejected) ? error.rejected : undefined,
});

const classifyEmailError = (error) => {
  if (error instanceof EmailConfigurationError || error?.name === 'EmailConfigurationError') return error;
  if (error instanceof EmailAuthenticationError || error?.name === 'EmailAuthenticationError') return error;
  if (error instanceof EmailRecipientError || error?.name === 'EmailRecipientError') return error;
  if (isAuthenticationError(error)) return new EmailAuthenticationError();
  if (isRecipientError(error)) return new EmailRecipientError();
  return new EmailDeliveryError();
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
  try {
    const config = getTransporter();
    await config.transporter.sendMail({
      from: config.from,
      to,
      subject,
      html,
      text,
    });
  } catch (error) {
    const classified = classifyEmailError(error);
    console.warn('[email] send failed', safeEmailErrorLog(error));
    throw classified;
  }
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
  EmailAuthenticationError,
  EmailConfigurationError,
  EmailDeliveryError,
  EmailRecipientError,
  classifyEmailError,
  smtpConfig,
  sendSignupOtpEmail,
  sendPasswordResetOtpEmail,
  resetEmailTransporter: () => { transporter = null; },
};
