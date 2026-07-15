const admin = require('firebase-admin');

class FirebaseAdminConfigurationError extends Error {
  constructor() {
    super('Firebase admin is not configured');
    this.name = 'FirebaseAdminConfigurationError';
  }
}

const serviceAccountFromEnv = () => {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    return JSON.parse(
      Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64')
        .toString('utf8'),
    );
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (projectId && clientEmail && privateKey) {
    return {
      projectId,
      clientEmail,
      privateKey,
    };
  }

  throw new FirebaseAdminConfigurationError();
};

const getFirebaseAdmin = () => {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountFromEnv()),
    });
  }
  return admin;
};

const verifyFirebaseIdToken = (idToken) =>
  getFirebaseAdmin().auth().verifyIdToken(idToken);

module.exports = {
  FirebaseAdminConfigurationError,
  verifyFirebaseIdToken,
};
