const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getComputedExamStatus,
  withComputedExamStatus,
} = require('../src/utils/examStatus');

const now = new Date('2026-07-13T10:00:00.000Z');

test('computes exam status from server time and stored publication state', () => {
  assert.equal(
    getComputedExamStatus({
      status: 'draft',
      startDateTime: '2026-07-13T09:00:00.000Z',
      endDateTime: '2026-07-13T09:30:00.000Z',
    }, now),
    'draft',
  );
  assert.equal(
    getComputedExamStatus({
      status: 'published',
      startDateTime: '2026-07-13T11:00:00.000Z',
      endDateTime: '2026-07-13T12:00:00.000Z',
    }, now),
    'upcoming',
  );
  assert.equal(
    getComputedExamStatus({
      status: 'published',
      startDateTime: '2026-07-13T09:00:00.000Z',
      endDateTime: '2026-07-13T10:30:00.000Z',
    }, now),
    'ongoing',
  );
  assert.equal(
    getComputedExamStatus({
      status: 'published',
      startDateTime: '2026-07-13T08:00:00.000Z',
      endDateTime: '2026-07-13T09:00:00.000Z',
    }, now),
    'completed',
  );
  assert.equal(
    getComputedExamStatus({
      status: 'completed',
      resultPublished: true,
      startDateTime: '2026-07-13T08:00:00.000Z',
      endDateTime: '2026-07-13T09:00:00.000Z',
    }, now),
    'result_published',
  );
});

test('decorates exam responses with display status and server timestamp', () => {
  const result = withComputedExamStatus({
    status: 'published',
    startDateTime: '2026-07-13T11:00:00.000Z',
    endDateTime: '2026-07-13T12:00:00.000Z',
  }, now);

  assert.equal(result.status, 'upcoming');
  assert.equal(result.computedStatus, 'upcoming');
  assert.equal(result.displayStatus, 'Upcoming');
  assert.equal(result.storedStatus, 'published');
  assert.equal(result.serverNow, now.toISOString());
});

test('keeps published anytime exams available after scheduled dates pass', () => {
  const result = withComputedExamStatus({
    status: 'published',
    isAnytimeExam: true,
    resultPublished: true,
    startDateTime: '2026-07-10T09:00:00.000Z',
    endDateTime: '2026-07-10T09:30:00.000Z',
  }, now);

  assert.equal(result.status, 'anytime');
  assert.equal(result.computedStatus, 'anytime');
  assert.equal(result.displayStatus, 'Anytime');
});
