const express = require('express');
const multer = require('multer');
const AppError = require('../utils/AppError');

const maxAvatarBytes = 5 * 1024 * 1024;

const multipartUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxAvatarBytes, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!String(file.mimetype || '').toLowerCase().startsWith('image/')) {
      return callback(new AppError(400, 'Only image files are accepted'));
    }
    callback(null, true);
  },
}).single('avatar');

const rawUpload = express.raw({ type: 'image/*', limit: maxAvatarBytes });

module.exports = (req, res, next) => {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('multipart/form-data')) return rawUpload(req, res, next);

  return multipartUpload(req, res, (error) => {
    if (error) {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError(413, 'Avatar image must be 5MB or smaller'));
      }
      if (error instanceof multer.MulterError) {
        return next(new AppError(400, error.message));
      }
      return next(error);
    }
    next();
  });
};
