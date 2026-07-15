const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidEmailFormat } = require('../src/controllers/authController');

test('auth email validation accepts normal addresses and rejects malformed signup emails', () => {
  assert.equal(isValidEmailFormat(' user@example.com '), true);
  assert.equal(isValidEmailFormat('USER.Name+tag@gmail.com'), true);
  assert.equal(isValidEmailFormat('abc@gmail'), false);
  assert.equal(isValidEmailFormat('abc@'), false);
  assert.equal(isValidEmailFormat('abc..def@example.com'), false);
  assert.equal(isValidEmailFormat('abc@example..com'), false);
  assert.equal(isValidEmailFormat('abc@example-.com'), false);
});
