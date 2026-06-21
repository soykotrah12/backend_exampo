const User = require('../model/user')
const { sendResponse } = require('../utils/sendResponse')
const AppError = require('../errors/AppError')
const catchAsync = require('../utils/catchAsync')
const slugify = require('slugify')
const path = require('path');
const AWS = require('aws-sdk');
const sharp = require('sharp')
const spacesEndpoint = new AWS.Endpoint('nyc3.digitaloceanspaces.com');
const s3 = new AWS.S3({
    endpoint: spacesEndpoint,
    accessKeyId:'APV6BH7W26ERAQXCHMWI',
    secretAccessKey: 'Nds4iqZuv3OfK/FNnlOb9PUl++tLTEWYGicycyyHlHY'
});


exports.parseImageUpload = async (userId, x, y, buffer, name) => {
    const Buffer = await sharp(buffer?.buffer)
        .resize(x, y) //Size Convert
        .jpeg({ quality: 90 }) // Convert to JPEG format
        .toBuffer();

    const fileNameWithoutExt = path.parse(buffer.originalname).name;

    // Generate unique file names
    const ImageName = `${userId}/images/${Date.now()}-${slugify(fileNameWithoutExt, { lower: true })}-${name}.jpeg`;

    // Prepare commands to upload to DigitalOcean Spaces
    await s3.putObject({
        Bucket: 'ts4uportal-all-files-upload',
        Key: ImageName,
        Body: Buffer,
        ACL: 'public-read',
        ContentType: 'image/jpeg'
    }).promise();
    return ImageName;
}

exports.uploadImage = catchAsync(async (req, res) => {
    const userId = req.user?._id;
    const user = await User.findById(userId);

    if (!user) {
        throw new AppError(400, 'User not found');
    }

    if (!req.file) {
        throw new AppError(400, 'No file uploaded!');
    }

    try {
        // Resize image using sharp

        const smallImage = await this.parseImageUpload(userId, 150, 150, req.file, "small");
        console.log(smallImage);
        const largeImage = await this.parseImageUpload(userId, 500, 500, req.file, "large");

        // Construct URLs for both images
        const smallImageUrl = `https://nyc3.digitaloceanspaces.com/ts4uportal-all-files-upload/${smallImage}`;
        const largeImageUrl = `https://nyc3.digitaloceanspaces.com/ts4uportal-all-files-upload/${largeImage}`;


        // Send response with image URLs
        sendResponse(res, {
            statusCode: 200,
            message: 'Profile updated successfully',
            success: true,
            data: {
                smallImage: smallImageUrl,
                fullImage: largeImageUrl
            }

        })

    } catch (error) {
        console.log(error)
        throw new AppError(500, 'Failed to process and convert the image');
    }
});


// const uploadToSpace = async (file) => {
//   await s3.putObject({
//     Bucket: 'ts4uportal-all-files-upload', // Your DigitalOcean Space name
//     Key: `uploads/${Date.now()}_${file.originalname}`, // Name of the file
//     Body: file.buffer, // File buffer from Multer
//     ContentType: file.mimetype, // Mime type of the file
//     ACL: 'public-read', // Set file permissions to public
//   }).promise();


// };

// // Controller function for handling file upload to DigitalOcean
// exports.uploadFiles = catchAsync(async (req, res) => {

//     if (err) {
//     //   return res.status(400).json({ message: 'File upload failed', error: err.message });
//       throw new AppError( 400, 'File upload failed');
//     }

//     if (!req.file) {
//     //   return res.status(400).json({ message: 'No file uploaded' });
//       throw new AppError( 400, 'No file uploaded');
//     }

//       // Upload the file to DigitalOcean Spaces
//       const result = await uploadToSpace(req.file);

//       // Respond with the URL of the uploaded file
//     //   res.status(200).json({
//     //     message: 'File uploaded successfully!',
//     //     fileUrl: result.Location,  // URL of the uploaded file
//     //   });

//       sendResponse(res,{
//         statusCode: 200,
//         message: 'File uploaded successfully',
//         success: true,
//         data: result.Location
//       })
//   });
