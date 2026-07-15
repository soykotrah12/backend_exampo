const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const {
  EmailConfigurationError,
  resetEmailTransporter,
  sendSignupOtpEmail,
  smtpConfig,
} = require('../src/services/emailService');

const envKeys = [
  'APP_NAME',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM',
  'EMAIL_USER',
  'EMAIL_PASS',
  'EMAIL_FROM',
];

const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

const clearEnv = () => {
  envKeys.forEach((key) => delete process.env[key]);
  resetEmailTransporter();
};

const resetEnv = () => {
  envKeys.forEach((key) => {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  });
  resetEmailTransporter();
};

test.beforeEach(clearEnv);
test.afterEach(resetEnv);

test('reads Azure SMTP env names and strips Gmail app password spaces', () => {
  process.env.SMTP_HOST = 'smtp.gmail.com';
  process.env.SMTP_PORT = '587';
  process.env.SMTP_SECURE = 'false';
  process.env.SMTP_USER = 'beachesr212@gmail.com';
  process.env.SMTP_PASS = 'abcd efgh ijkl mnop';
  process.env.SMTP_FROM = 'beachesr212@gmail.com';

  assert.deepEqual(smtpConfig(), {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    user: 'beachesr212@gmail.com',
    pass: 'abcdefghijklmnop',
    from: 'beachesr212@gmail.com',
  });
});

test('supports legacy EMAIL_* fallback names', () => {
  process.env.SMTP_HOST = 'smtp.gmail.com';
  process.env.SMTP_PORT = '587';
  process.env.EMAIL_USER = 'legacy@example.com';
  process.env.EMAIL_PASS = 'legacy pass';
  process.env.EMAIL_FROM = 'sender@example.com';

  assert.deepEqual(smtpConfig(), {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    user: 'legacy@example.com',
    pass: 'legacypass',
    from: 'sender@example.com',
  });
});

test('configuration error reports missing env keys without exposing SMTP_PASS', () => {
  process.env.SMTP_HOST = 'smtp.gmail.com';
  process.env.SMTP_PORT = '587';
  process.env.SMTP_USER = 'beachesr212@gmail.com';
  process.env.SMTP_PASS = '';

  assert.throws(
    () => smtpConfig(),
    (error) => {
      assert.equal(error instanceof EmailConfigurationError, true);
      assert.match(error.message, /SMTP_PASS or EMAIL_PASS/);
      assert.doesNotMatch(error.message, /beachesr212@gmail\.com/);
      return true;
    },
  );
});

test('signup OTP email sends through Nodemailer with resolved Gmail SMTP config', async () => {
  process.env.APP_NAME = 'Exampo';
  process.env.SMTP_HOST = 'smtp.gmail.com';
  process.env.SMTP_PORT = '587';
  process.env.SMTP_SECURE = 'false';
  process.env.SMTP_USER = 'beachesr212@gmail.com';
  process.env.SMTP_PASS = 'abcd efgh ijkl mnop';
  process.env.SMTP_FROM = 'beachesr212@gmail.com';

  const originalCreateTransport = nodemailer.createTransport;
  let transportOptions;
  let mailOptions;

  nodemailer.createTransport = (options) => {
    transportOptions = options;
    return {
      sendMail: async (message) => {
        mailOptions = message;
        return { accepted: [message.to] };
      },
    };
  };

  try {
    await sendSignupOtpEmail({
      to: 'new-user@example.com',
      otp: '123456',
      expiresInMinutes: 10,
    });
  } finally {
    nodemailer.createTransport = originalCreateTransport;
  }

  assert.deepEqual(transportOptions, {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: 'beachesr212@gmail.com',
      pass: 'abcdefghijklmnop',
    },
  });
  assert.equal(mailOptions.from, 'beachesr212@gmail.com');
  assert.equal(mailOptions.to, 'new-user@example.com');
  assert.match(mailOptions.subject, /Verify your Exampo account/);
  assert.match(mailOptions.text, /123456/);
});
