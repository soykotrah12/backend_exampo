const express = require('express');
const multer = require('multer');
const AppError = require('../utils/AppError');

const maxVerificationBytes = 10 * 1024 * 1024;

const multipartUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxVerificationBytes, files: 1 },
  fileFilter: (_req, file, callback) => {
    const mimetype = String(file.mimetype || '').toLowerCase();
    const originalName = String(file.originalname || '').toLowerCase();
    if (mimetype !== 'application/pdf' && mimetype !== 'application/x-pdf' && !originalName.endsWith('.pdf')) {
      return callback(new AppError(400, 'Only PDF files are allowed'));
    }
    callback(null, true);
  },
}).single('document');

const rawUpload = express.raw({
  type: ['application/pdf', 'application/x-pdf'],
  limit: maxVerificationBytes,
});

module.exports = (req, res, next) => {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('multipart/form-data')) return rawUpload(req, res, next);

  return multipartUpload(req, res, (error) => {
    if (error) {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError(413, 'Verification PDF must be 10MB or smaller'));
      }
      if (error instanceof multer.MulterError) {
        return next(new AppError(400, error.message));
      }
      return next(error);
    }
    next();
  });
};
