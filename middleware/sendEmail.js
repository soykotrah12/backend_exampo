
const sgMail = require('@sendgrid/mail');
let apiKey = "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"
sgMail.setApiKey(apiKey);

exports.sendDynamicEmail = async (email, templateId, dynamicTemplateData) => {


  const msg = {
    to: email,
    from: 'hello@schoolshub.ai',
    templateId,
    dynamicTemplateData,
    // Use the email address or domain you verified above
    // subject: subject,
    // //text: 'and easy to do anywhere, even with Node.js',
    // html: text,
  }

  return new Promise((resolve, reject) => {
    sgMail
      .setApiKey(apiKey)
      .send(msg)
      .then(() => {
        resolve({ success: true })
      }, error => {
        console.error(error);

        if (error.response) {
          reject({ success: false })
          console.error(error.response.body)
        } else {
          resolve({ success: true })
        }
      });
  })


}

exports.sendEmail = (email, subject, html) => {
  const msg = {
    to: email,
    from: 'hello@schoolshub.ai',
    subject: subject,
    html,
  }


  return new Promise((resolve, reject) => {
    sgMail
      .setApiKey(apiKey)
      .send(msg)
      .then(() => {
        resolve({ success: true })
      }, error => {
        console.error(error);

        if (error.response) {
          reject({ success: false })
          console.error(error.response.body)
        } else {
          resolve({ success: true })
        }
      });
  })
}