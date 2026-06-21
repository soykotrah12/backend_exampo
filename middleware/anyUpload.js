

const multer = require('multer');
const multerS3 = require('multer-s3');
const slugify = require('slugify')

const AWS = require('aws-sdk');


const spacesEndpoint = new AWS.Endpoint('nyc3.digitaloceanspaces.com');
const s3 = new AWS.S3({
    endpoint: spacesEndpoint,
    accessKeyId:'APV6BH7W26ERAQXCHMWI',
    secretAccessKey: 'Nds4iqZuv3OfK/FNnlOb9PUl++tLTEWYGicycyyHlHY'
});


const upload = multer({
    storage: multerS3({
      s3: s3,
      bucket: 'ts4uportal-all-files-upload',
      acl: 'public-read',
      key: function (request, file, cb) {
        //console.log(file);
        cb(null, `pm-attachments/${Date.now()}-${slugify(file.originalname)}`);
      }
    })
  })
//enrollment
module.exports = upload.array('files', 6);;