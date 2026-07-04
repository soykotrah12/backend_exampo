const AppError = require('../utils/AppError');

const clean = (value) => String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
const parseCsv = (input) => {
  const rows = []; let row = [], field = '', quoted = false;
  const text = input.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field); if (row.some((x) => x.trim())) rows.push(row); row = []; field = ''; }
    else if (char !== '\r') field += char;
  }
  if (quoted) throw new AppError(400, 'CSV contains an unclosed quoted value');
  row.push(field); if (row.some((x) => x.trim())) rows.push(row);
  return rows;
};
const booleanValue = (raw) => {
  const value = clean(raw).toLowerCase();
  if (['true','t','yes','1'].includes(value)) return true;
  if (['false','f','no','0'].includes(value)) return false;
  return null;
};
const requiredHeaders = {
  trueFalse: ['question_no','question_text','statement_a','answer_a','statement_b','answer_b','statement_c','answer_c','statement_d','answer_d','statement_e','answer_e','marks'],
  singleBest: ['question_no','question_text','option_a','option_b','option_c','option_d','correct_answer','marks'],
};
exports.samples = {
  trueFalse: `${requiredHeaders.trueFalse.join(',')}\n1,"Which statements are correct?","Statement A",TRUE,"Statement B",FALSE,"Statement C",TRUE,"Statement D",FALSE,"Statement E",TRUE,1`,
  singleBest: `${requiredHeaders.singleBest.join(',')}\n51,"Which option is best?","Option A","Option B","Option C","Option D","C",1`,
};
exports.parseQuestions = (buffer, kind) => {
  const rows = parseCsv(buffer.toString('utf8'));
  if (rows.length < 2) return { totalRows: Math.max(0, rows.length - 1), questions: [], errors: [{ row: 1, message: 'CSV must contain a header and at least one data row' }] };
  const expected = requiredHeaders[kind];
  const headers = rows[0].map((x) => clean(x).toLowerCase());
  const missing = expected.filter((header) => !headers.includes(header));
  if (missing.length) return { totalRows: rows.length - 1, questions: [], errors: [{ row: 1, message: `Missing headers: ${missing.join(', ')}` }] };
  const index = Object.fromEntries(headers.map((header, i) => [header, i]));
  const errors = [], questions = [], seen = new Set();
  rows.slice(1).forEach((columns, offset) => {
    const row = offset + 2; const get = (key) => clean(columns[index[key]]); const questionNo = Number(get('question_no')); const marksText = get('marks'); const marks = marksText === '' ? 1 : Number(marksText);
    const fail = (message) => errors.push({ row, message });
    if (!Number.isInteger(questionNo) || questionNo < 1) return fail('question_no must be a positive integer');
    if (seen.has(questionNo)) return fail(`Duplicate question_no ${questionNo} inside CSV`); seen.add(questionNo);
    if (!get('question_text')) return fail('question_text is required');
    if (!Number.isFinite(marks) || marks <= 0) return fail('marks must be a positive number');
    if (kind === 'trueFalse') {
      const statements = 'abcde'.split('').map((letter) => ({ label: letter.toUpperCase(), text: get(`statement_${letter}`), correctAnswer: booleanValue(get(`answer_${letter}`)) }));
      if (statements.some((item) => !item.text)) return fail('statement_a to statement_e are required');
      if (statements.some((item) => item.correctAnswer === null)) return fail('answers must be TRUE/FALSE, T/F, Yes/No, or 1/0');
      questions.push({ questionNo, type: 'TRUE_FALSE_GROUP', questionText: get('question_text'), statements, marks, order: questionNo });
    } else {
      const correct = get('correct_answer').toUpperCase(); if (!['A','B','C','D'].includes(correct)) return fail('correct_answer must be A, B, C, or D');
      const options = 'abcd'.split('').map((letter) => ({ label: letter.toUpperCase(), text: get(`option_${letter}`), isCorrect: correct === letter.toUpperCase() }));
      if (options.some((item) => !item.text)) return fail('option_a to option_d are required');
      questions.push({ questionNo, type: 'SINGLE_BEST_ANSWER', questionText: get('question_text'), options, marks, order: questionNo });
    }
  });
  return { totalRows: rows.length - 1, questions, errors };
};
