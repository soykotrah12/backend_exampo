const express = require('express')
//const { } = require('../common-middleware')
const router = express.Router()
const { requireSignin } = require('../middleware/authMiddleware');
const imageUpload = require('../middleware/imageUpload');
const { uploadImage } = require('../controller/upload');
const { uploadAttachments } = require('../controller/item');
const anyUpload = require('../middleware/anyUpload')

router.post('/upload-image',requireSignin,imageUpload.single('image'),uploadImage);
router.post('/',requireSignin, anyUpload, uploadAttachments)
module.exports = router