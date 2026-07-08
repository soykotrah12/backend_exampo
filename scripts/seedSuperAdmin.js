require('dotenv').config();

const mongoose = require('mongoose');
const User = require('../src/models/User');

const mongoUrl =
  process.env.MONGO_DB_URL || 'mongodb://127.0.0.1:27017/exam_saas';

async function seedSuperAdmin() {
  const name = String(process.env.SUPER_ADMIN_NAME || '').trim();
  const email = String(process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.SUPER_ADMIN_PASSWORD || '');

  if (!name) throw new Error('SUPER_ADMIN_NAME is required');
  if (!email) throw new Error('SUPER_ADMIN_EMAIL is required');
  if (!password) throw new Error('SUPER_ADMIN_PASSWORD is required');
  if (password.length < 8) {
    throw new Error('SUPER_ADMIN_PASSWORD must contain at least 8 characters');
  }

  await mongoose.connect(mongoUrl);

  const existing = await User.findOne({ email }).select('+password');

  if (existing) {
    let changed = false;

    if (existing.role !== 'super_admin') {
      existing.role = 'super_admin';
      changed = true;
    }

    if (existing.name !== name) {
      existing.name = name;
      changed = true;
    }

    if (existing.isActive !== true) {
      existing.isActive = true;
      changed = true;
    }

    if (changed) {
      await existing.save();
    }

    console.log('Super admin already exists');
    return;
  }

  await User.create({
    name,
    email,
    password,
    role: 'super_admin',
    isActive: true,
  });

  console.log('Super admin created');
}

seedSuperAdmin()
  .catch((error) => {
    console.error(`Failed to seed super admin: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });