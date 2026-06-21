require('dotenv').config();
const mongoose = require('mongoose');
const app = require('./src/app');

const port = Number(process.env.PORT || 8001);
const mongoUrl = process.env.MONGO_DB_URL || 'mongodb://127.0.0.1:27017/exam_saas';

mongoose.connect(mongoUrl).then(() => {
  app.listen(port, () => console.log(`Exam API listening on ${port}`));
}).catch((error) => {
  console.error('MongoDB connection failed:', error.message);
  process.exitCode = 1;
});
