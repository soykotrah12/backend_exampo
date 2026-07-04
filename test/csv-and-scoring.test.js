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
