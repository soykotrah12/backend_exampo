require('dotenv').config();
const mongoose = require('mongoose');
const Plan = require('../models/Plan');
const base = { analyticsEnabled: false, exportEnabled: false, brandingEnabled: false, questionBankEnabled: false };
const plans = [
  { name: 'Free', code: 'FREE', priceMonthly: 0, priceYearly: 0, limits: { ...base, teachersLimit: 1, studentsLimit: 20, examSlotsPerMonth: 3, questionsPerExam: 20, writtenQuestionsPerExam: 5 } },
  { name: 'Basic', code: 'BASIC', priceMonthly: 19, priceYearly: 190, limits: { ...base, teachersLimit: 5, studentsLimit: 150, examSlotsPerMonth: 20, questionsPerExam: 100, writtenQuestionsPerExam: 25, analyticsEnabled: true } },
  { name: 'Pro', code: 'PRO', priceMonthly: 49, priceYearly: 490, limits: { ...base, teachersLimit: 20, studentsLimit: 1000, examSlotsPerMonth: 100, questionsPerExam: 250, writtenQuestionsPerExam: 100, analyticsEnabled: true, exportEnabled: true, questionBankEnabled: true } },
  { name: 'Institution', code: 'INSTITUTION', priceMonthly: 149, priceYearly: 1490, limits: { teachersLimit: 200, studentsLimit: 10000, examSlotsPerMonth: 1000, questionsPerExam: 500, writtenQuestionsPerExam: 250, analyticsEnabled: true, exportEnabled: true, brandingEnabled: true, questionBankEnabled: true } },
];
mongoose.connect(process.env.MONGO_DB_URL || 'mongodb://127.0.0.1:27017/exam_saas').then(async () => { for (const plan of plans) await Plan.findOneAndUpdate({ code: plan.code }, plan, { upsert: true }); console.log('Plans seeded'); await mongoose.disconnect(); }).catch((e) => { console.error(e); process.exitCode = 1; });
