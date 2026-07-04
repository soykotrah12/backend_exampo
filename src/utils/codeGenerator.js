const crypto = require('crypto');

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

exports.generateCode = (prefix) => {
  const bytes = crypto.randomBytes(6);
  let suffix = '';
  for (let index = 0; index < 6; index += 1) suffix += alphabet[bytes[index] % alphabet.length];
  return `${prefix}-${suffix}`;
};
