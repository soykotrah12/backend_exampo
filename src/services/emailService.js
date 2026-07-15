const nodemailer = require('nodemailer');

class EmailConfigurationError extends Error {
  constructor() {
    super('Email service is not configured');
    this.name = 'EmailConfigurationError';
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
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;
  if (!host || !port || !user || !pass || !from) throw new EmailConfigurationError();
  return { host, port, secure, user, pass, from };
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
  sendSignupOtpEmail,
  sendPasswordResetOtpEmail,
};
