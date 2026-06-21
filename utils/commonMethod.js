const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');


// Generate a random OTP
exports.generateOTP = () => {
    const OTP_LENGTH = 6;
    const otp = Array.from({ length: OTP_LENGTH }, () => crypto.randomInt(0, 9)).join('');
    return otp;
};


//Generate unique ID
exports.generateUniqueId = () => {
    const timestamp = Date.now().toString(36); // Convert current timestamp to base36 string
    const randomPart = Math.random().toString(36).substr(2, 6); // Get 6 random characters

    const uniquePart = timestamp + randomPart;
    const uniqueId = uniquePart.substring(0, 8);

    return `BK${uniqueId}`;
}

//password hashing
exports.hashPassword = async (newPassword) => {
    const salt = await bcrypt.genSalt(Number.parseInt(10));
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    return Promise.resolve(hashedPassword)
}


exports.uniqueTransactionId = () => {
    return uuidv4().replace(/-/g, '').substr(0, 12).toUpperCase();
}


