require('dotenv').config();

const mongoose = require('mongoose');
const app = require('./src/app');
const Submission = require('./src/models/Submission');

mongoose.set('strictQuery', false);


const port = process.env.PORT || 8001; 
const mongoUrl =
  process.env.MONGO_DB_URL || 'mongodb://127.0.0.1:27017/exam_saas';

const ensureSubmissionAttemptIndexes = async () => {
  const indexes = await Submission.collection.indexes();
  const legacy = indexes.find((index) =>
    index.unique === true &&
    index.key?.examSlot === 1 &&
    index.key?.student === 1 &&
    index.key?.attemptNumber === undefined
  );
  if (legacy) await Submission.collection.dropIndex(legacy.name);
  await Submission.collection.createIndex({ examSlot: 1, student: 1, attemptNumber: 1 }, { unique: true });
  await Submission.collection.createIndex({ examSlot: 1, student: 1, submittedAt: -1 });
};

mongoose
  .connect(mongoUrl)
  .then(async () => {
    await ensureSubmissionAttemptIndexes();
    app.listen(port, () => {
      console.log(`Exam API listening on ${port}`);
    });
  })
  .catch((error) => {
    console.error('MongoDB connection failed:', error.message);
    process.exitCode = 1;
  });
