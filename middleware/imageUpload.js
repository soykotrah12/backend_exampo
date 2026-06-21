const multer = require("multer");

const storage = multer.memoryStorage();

//fileFilter function to filter the file type
const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png') {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type, only JPEG and PNG are allowed!'));
  }
};


// Initialize multer with the storage configuration
const imageUpload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // Limit file size to 10MB
  fileFilter: fileFilter
});



//  exports.audioUpload = multer({
//   storage: storage,
//   limits: { fileSize: 50 * 1024 * 1024 }, // Limit file size to 50MB
// }).single('file');  // Expect a single file field called 'file'

module.exports = imageUpload;