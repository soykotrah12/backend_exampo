require('dotenv').config();

const mongoose = require('mongoose');
const User = require('../models/User');

const main = async () => {
  const email = String(process.env.SUPER_ADMIN_EMAIL || '').toLowerCase().trim();
  const password = String(process.env.SUPER_ADMIN_PASSWORD || '');
  const name = String(process.env.SUPER_ADMIN_NAME || 'Super Admin').trim();
  if (!email || !password) {
    throw new Error('Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD before running this script');
  }
  if (password.length < 12) {
    throw new Error('SUPER_ADMIN_PASSWORD must be at least 12 characters');
  }
  await mongoose.connect(process.env.MONGO_DB_URL || 'mongodb://127.0.0.1:27017/exam_saas');
  const existing = await User.findOne({ email });
  if (existing) {
    existing.role = 'super_admin';
    existing.name = existing.name || name;
    existing.isActive = true;
    existing.isEmailVerified = true;
    await existing.save();
    console.log(`Updated existing super admin: ${email}`);
  } else {
    await User.create({ name, email, password, role: 'super_admin', isEmailVerified: true });
    console.log(`Created super admin: ${email}`);
  }
  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
