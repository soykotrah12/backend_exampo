const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RETAKE_PENDING_MESSAGE,
  buildStudentExamAccess,
} = require('../src/services/examAttemptService');

const now = new Date('2026-07-13T10:00:00.000Z');

const scheduled = {
  status: 'published',
  startDateTime: '2026-07-13T09:00:00.000Z',
  endDateTime: '2026-07-13T11:00:00.000Z',
};

const anytime = {
  ...scheduled,
  isAnytimeExam: true,
};

test('scheduled exam keeps single active-window attempt behavior', () => {
  assert.equal(buildStudentExamAccess({ slot: scheduled, now }).canStart, true);
  const submitted = buildStudentExamAccess({
    slot: scheduled,
    now,
    latestSubmission: { attemptNumber: 1, resultPublished: true },
  });

  assert.equal(submitted.canStart, false);
  assert.equal(submitted.cannotStartMessage, 'This exam has already been submitted');
});

test('anytime exam allows first attempt and published-result retake', () => {
  const first = buildStudentExamAccess({ slot: anytime, now });
  assert.equal(first.canStart, true);
  assert.equal(first.nextAttemptNumber, 1);

  const retake = buildStudentExamAccess({
    slot: anytime,
    now,
    latestSubmission: { attemptNumber: 1, resultPublished: true },
  });
  assert.equal(retake.canStart, true);
  assert.equal(retake.canRetake, true);
  assert.equal(retake.nextAttemptNumber, 2);
});

test('anytime exam blocks retake while latest result is pending', () => {
  const pending = buildStudentExamAccess({
    slot: anytime,
    now,
    latestSubmission: { attemptNumber: 2, resultPublished: false },
  });

  assert.equal(pending.canStart, false);
  assert.equal(pending.lastSubmissionStatus, 'pending');
  assert.equal(pending.cannotStartMessage, RETAKE_PENDING_MESSAGE);
});

test('instant anytime exam allows immediate retake after submit', () => {
  const instant = buildStudentExamAccess({
    slot: { ...anytime, resultVisibilityMode: 'instant' },
    now,
    latestSubmission: { attemptNumber: 3, resultPublished: false },
  });

  assert.equal(instant.canStart, true);
  assert.equal(instant.canRetake, true);
  assert.equal(instant.nextAttemptNumber, 4);
});
