const AppError = require('../utils/AppError');

exports.validateAndScore = (questions, submittedAnswers) => {
  const byId = new Map(questions.map((q) => [q._id.toString(), q]));
  const seen = new Set();
  let mcqScore = 0;
  const answers = submittedAnswers.map((raw) => {
    if (seen.has(String(raw.questionId))) throw new AppError(400, 'A question may only be answered once');
    seen.add(String(raw.questionId));
    const question = byId.get(String(raw.questionId));
    if (!question || raw.type !== question.type) throw new AppError(400, 'An answer does not belong to this exam');
    const result = { questionId: question._id, type: question.type, awardedMarks: 0 };
    if (question.type === 'TRUE_FALSE_GROUP') {
      const values = raw.answers || {};
      const statements = Array.isArray(question.statements) ? question.statements : [];
      const labels = new Set(statements.map((item) => item.label));
      if (Object.keys(values).some((key) => !labels.has(key) || typeof values[key] !== 'boolean')) throw new AppError(400, 'Invalid true/false answer');
      result.answers = values;
      const totalMarks = Number.isFinite(Number(question.marks)) ? Number(question.marks) : 1;
      const totalStatements = statements.length;
      const correctCount = statements.filter((item) => values[item.label] === item.correctAnswer).length;
      const earnedMarks = totalStatements > 0 ? (totalMarks / totalStatements) * correctCount : 0;
      result.correctCount = correctCount;
      result.totalStatements = totalStatements;
      result.totalMarks = totalMarks;
      result.earnedMarks = Number(earnedMarks.toFixed(6));
      result.awardedMarks = result.earnedMarks;
      mcqScore += result.awardedMarks;
    } else if (question.type === 'SINGLE_BEST_ANSWER') {
      if (!question.options.some((item) => item.label === raw.selectedOption)) throw new AppError(400, 'Invalid selected option');
      result.selectedOption = raw.selectedOption;
      result.awardedMarks = question.options.find((item) => item.label === raw.selectedOption)?.isCorrect ? question.marks : 0;
      mcqScore += result.awardedMarks;
    } else {
      const value = String(raw.writtenAnswer || '').trim();
      if (question.wordLimit && value.split(/\s+/).filter(Boolean).length > question.wordLimit) throw new AppError(400, 'A written answer exceeds its word limit');
      result.writtenAnswer = value;
    }
    return result;
  });
  return { answers, mcqScore: Number(mcqScore.toFixed(6)) };
};
