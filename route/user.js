const express = require('express')
//const { } = require('../common-middleware')
const router = express.Router()
const {
    register,
    login,
    verify,
    verifyOtp,
    getUsers,
    forgotPassword,
    verifyResetPasswordCode,
    resetPassword,
    getUserStatus,
    refreshTokenHandler,
    logoutUser,
    findUserByID,
    resendOTP,
    googleAuth,
    saveTheme,
    getTheme
} = require('../controller/user')
const { requireSignin } = require('../middleware/authMiddleware')
const { generateText } = require('../controller/openAi')
const { dashboard } = require('../controller/dashboard')
const { getPinnedItems, addPin } = require('../controller/pinController')

router.post('/register', register)
router.post('/login', login)
router.post('/google-auth', googleAuth)
router.post('/verify', verify)
router.post('/verify-otp',verifyOtp)
// Refresh Token Route
router.post('/refresh-token', refreshTokenHandler);
router.post('/allusers',requireSignin,getUsers)

router.post('/forgot-password',forgotPassword)
router.post('/verify-forgot-password-code',verifyResetPasswordCode)
router.post('/reset-password',resetPassword)

router.get('/get-user-info/:email',getUserStatus)
router.post('/logout',logoutUser)
router.get('/get-user/:id', requireSignin,findUserByID)
router.post('/resend-otp',resendOTP)
router.post('/generate-text',requireSignin, generateText)
router.post('/save-theme',requireSignin, saveTheme)
router.get('/get-theme',requireSignin, getTheme)
router.post("/dashboard",requireSignin,dashboard)
router.post("/pin",requireSignin,addPin)
router.get("/get-pin/:source",requireSignin,getPinnedItems)
module.exports = router