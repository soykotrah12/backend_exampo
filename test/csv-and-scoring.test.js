const test = require('node:test');
const assert = require('node:assert/strict');
const csv = require('../src/services/csvImportService');
const scoring = require('../src/services/scoringService');

test('imports every valid true/false CSV row and normalizes boolean variants', () => {
  const source = `${csv.samples.trueFalse}\n2,"Second question","A",T,"B",F,"C",Yes,"D",No,"E",1,2`;
  const result = csv.parseQuestions(Buffer.from(source), 'trueFalse');
  assert.equal(result.errors.length, 0);
  assert.equal(result.questions.length, 2);
  assert.deepEqual(result.questions[1].statements.map((x) => x.correctAnswer), [true, false, true, false, true]);
});

test('imports single best answer and reports duplicate question numbers atomically', () => {
  const valid = csv.parseQuestions(Buffer.from(csv.samples.singleBest), 'singleBest');
  assert.equal(valid.questions[0].options.find((x) => x.isCorrect).label, 'C');
  const duplicate = csv.parseQuestions(Buffer.from(`${csv.samples.singleBest}\n51,"Duplicate","A","B","C","D",A,1`), 'singleBest');
  assert.equal(duplicate.errors.length, 1);
  assert.match(duplicate.errors[0].message, /Duplicate question_no/);
});

test('scores mixed true/false and single best submissions', () => {
  const id = (value) => ({ toString: () => value });
  const questions = [
    { _id: id('tf'), type: 'TRUE_FALSE_GROUP', marks: 5, statements: 'ABCDE'.split('').map((label, i) => ({ label, correctAnswer: i < 3 })) },
    { _id: id('sba'), type: 'SINGLE_BEST_ANSWER', marks: 2, options: 'ABCD'.split('').map((label) => ({ label, isCorrect: label === 'C' })) },
  ];
  const result = scoring.validateAndScore(questions, [
    { questionId: 'tf', type: 'TRUE_FALSE_GROUP', answers: { A: true, B: true, C: true, D: false, E: false } },
    { questionId: 'sba', type: 'SINGLE_BEST_ANSWER', selectedOption: 'C' },
  ]);
  assert.equal(result.mcqScore, 7);
  assert.equal(result.answers.length, 2);
});

test('awards dynamic partial marks and stores true/false scoring details', () => {
  const id = (value) => ({ toString: () => value });
  const question = (name, marks, count) => ({
    _id: id(name), type: 'TRUE_FALSE_GROUP', marks,
    statements: Array.from({ length: count }, (_, index) => ({ label: String.fromCharCode(65 + index), correctAnswer: true })),
  });
  const score = (q, correct) => scoring.validateAndScore([q], [{
    questionId: q._id.toString(), type: 'TRUE_FALSE_GROUP',
    answers: Object.fromEntries(q.statements.map((item, index) => [item.label, index < correct])),
  }]);

  const threeOfFive = score(question('one', 1, 5), 3);
  assert.equal(threeOfFive.mcqScore, 0.6);
  assert.deepEqual(
    { correctCount: threeOfFive.answers[0].correctCount, totalStatements: threeOfFive.answers[0].totalStatements, earnedMarks: threeOfFive.answers[0].earnedMarks, totalMarks: threeOfFive.answers[0].totalMarks },
    { correctCount: 3, totalStatements: 5, earnedMarks: 0.6, totalMarks: 1 },
  );
  assert.equal(score(question('two', 2, 5), 4).mcqScore, 1.6);
  assert.equal(score(question('three', 1, 4), 2).mcqScore, 0.5);
  assert.equal(score(question('four', 5, 5), 5).mcqScore, 5);
});

test('true/false scoring safely defaults missing marks and handles no statements', () => {
  const id = (value) => ({ toString: () => value });
  const missingMarks = { _id: id('missing'), type: 'TRUE_FALSE_GROUP', statements: [{ label: 'A', correctAnswer: true }] };
  assert.equal(scoring.validateAndScore([missingMarks], [{ questionId: 'missing', type: 'TRUE_FALSE_GROUP', answers: { A: true } }]).mcqScore, 1);
  const empty = { _id: id('empty'), type: 'TRUE_FALSE_GROUP', marks: 1, statements: [] };
  const result = scoring.validateAndScore([empty], [{ questionId: 'empty', type: 'TRUE_FALSE_GROUP', answers: {} }]);
  assert.equal(result.mcqScore, 0);
  assert.equal(result.answers[0].totalStatements, 0);
});
