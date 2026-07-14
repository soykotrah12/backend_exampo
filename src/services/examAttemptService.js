const { getComputedExamStatus } = require('../utils/examStatus');

const RETAKE_PENDING_MESSAGE = 'You can retake this exam after your result is published.';

const activePublicationStatuses = new Set(['published', 'ongoing', 'completed']);

const isInstantResult = (slot) => slot?.resultVisibilityMode === 'instant';

const attemptNumberOf = (submission) => {
  const value = Number(submission?.attemptNumber);
  return Number.isFinite(value) && value > 0 ? value : submission ? 1 : 0;
};

const isExamPublishedForAccess = (slot) => {
  const status = String(slot?.status || '').toLowerCase();
  return activePublicationStatuses.has(status);
};

const isSubmissionResultPublished = (slot, submission) => {
  if (!submission) return false;
  if (isInstantResult(slot)) return true;
  if (slot?.isAnytimeExam === true) return submission.resultPublished === true;
  return submission.resultPublished === true || slot?.resultPublished === true;
};

const studentAccessStatus = ({
  hasAccess,
  requestStatus,
  latestSubmission,
  resultPublished,
  canStart,
  isAnytimeExam,
}) => {
  if (!hasAccess) return requestStatus === 'pending' ? 'Requested' : 'Locked';
  if (!latestSubmission) return 'Assigned';
  if (!isAnytimeExam) return 'Submitted';
  if (!resultPublished) return 'Result Pending';
  return canStart ? 'Retake Available' : 'Submitted';
};

const buildStudentExamAccess = ({
  slot,
  latestSubmission = null,
  now = new Date(),
  hasAccess = true,
  requestStatus = '',
}) => {
  const isAnytimeExam = slot?.isAnytimeExam === true;
  const computedStatus = getComputedExamStatus(slot, now);
  const latestAttemptNumber = attemptNumberOf(latestSubmission);
  const resultPublished = isSubmissionResultPublished(slot, latestSubmission);
  let canStart = false;
  let cannotStartMessage = '';

  if (!hasAccess) {
    cannotStartMessage = 'You do not have access to this exam';
  } else if (isAnytimeExam) {
    if (!isExamPublishedForAccess(slot)) {
      cannotStartMessage = 'The exam is not published yet';
    } else if (!latestSubmission || resultPublished) {
      canStart = true;
    } else {
      cannotStartMessage = RETAKE_PENDING_MESSAGE;
    }
  } else if (latestSubmission) {
    cannotStartMessage = 'This exam has already been submitted';
  } else if (computedStatus === 'ongoing') {
    canStart = true;
  } else {
    cannotStartMessage = 'The exam is not active';
  }

  return {
    isAnytimeExam,
    submitted: Boolean(latestSubmission),
    submissionId: latestSubmission?._id,
    resultAvailable: resultPublished,
    resultPublished,
    canStart,
    canRetake: Boolean(isAnytimeExam && latestSubmission && canStart),
    cannotStartMessage,
    lastSubmissionStatus: latestSubmission
      ? resultPublished
        ? 'published'
        : 'pending'
      : 'none',
    latestAttemptNumber,
    nextAttemptNumber: canStart ? latestAttemptNumber + 1 : null,
    accessStatus: studentAccessStatus({
      hasAccess,
      requestStatus,
      latestSubmission,
      resultPublished,
      canStart,
      isAnytimeExam,
    }),
  };
};

module.exports = {
  RETAKE_PENDING_MESSAGE,
  attemptNumberOf,
  buildStudentExamAccess,
  isExamPublishedForAccess,
  isInstantResult,
  isSubmissionResultPublished,
};
