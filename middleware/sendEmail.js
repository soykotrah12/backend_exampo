let sgMail;

const getSendGrid = () => {
  if (!process.env.SENDGRID_API_KEY) throw new Error('Email service is not configured');
  if (!sgMail) {
    sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  }
  return sgMail;
};

const fromAddress = () => process.env.SENDGRID_FROM || process.env.SMTP_FROM || 'beachesr212@gmail.com';

exports.sendDynamicEmail = async (email, templateId, dynamicTemplateData) => {
  const client = getSendGrid();
  await client.send({
    to: email,
    from: fromAddress(),
    templateId,
    dynamicTemplateData,
  });
  return { success: true };
};

exports.sendEmail = async (email, subject, html) => {
  const client = getSendGrid();
  await client.send({
    to: email,
    from: fromAddress(),
    subject,
    html,
  });
  return { success: true };
};
