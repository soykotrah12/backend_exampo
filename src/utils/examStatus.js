const labels = {
  draft: 'Draft',
  upcoming: 'Upcoming',
  ongoing: 'Ongoing',
  completed: 'Completed',
  result_published: 'Result Published',
  cancelled: 'Cancelled',
  archived: 'Archived',
};

const terminalStatuses = new Set(['draft', 'cancelled', 'archived']);

function getComputedExamStatus(exam, now = new Date()) {
  const stored = String(exam.status || 'draft').toLowerCase();
  if (terminalStatuses.has(stored)) return stored;

  const start = new Date(exam.startDateTime);
  const end = new Date(exam.endDateTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return stored || 'draft';
  }

  if (now < start) return 'upcoming';
  if (now <= end) return 'ongoing';
  if (exam.resultPublished === true) return 'result_published';
  return 'completed';
}

function statusPayload(exam, now = new Date()) {
  const computedStatus = getComputedExamStatus(exam, now);
  return {
    status: computedStatus,
    computedStatus,
    displayStatus: labels[computedStatus] || computedStatus,
    storedStatus: exam.status,
    serverNow: now.toISOString(),
  };
}

function withComputedExamStatus(exam, now = new Date()) {
  return {
    ...exam,
    ...statusPayload(exam, now),
  };
}

module.exports = {
  getComputedExamStatus,
  statusPayload,
  withComputedExamStatus,
};
