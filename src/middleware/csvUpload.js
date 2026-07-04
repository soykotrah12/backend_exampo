const express = require('express');
const AppError = require('../utils/AppError');

const parseBody = express.raw({ type: ['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain'], limit: '2mb' });
module.exports = (req, res, next) => parseBody(req, res, (error) => {
  if (error) return next(new AppError(error.type === 'entity.too.large' ? 413 : 400, error.type === 'entity.too.large' ? 'CSV file must not exceed 2 MB' : 'Unable to read CSV file'));
  const fileName = String(req.headers['x-file-name'] || '');
  if (!fileName.toLowerCase().endsWith('.csv')) return next(new AppError(400, 'Only .csv files are accepted'));
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) return next(new AppError(400, 'CSV file is empty'));
  req.file = { originalname: fileName, mimetype: req.headers['content-type'], buffer: req.body };
  next();
});
