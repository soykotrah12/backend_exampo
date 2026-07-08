const express = require('express');
const admin = require('../controllers/adminController');

const router = express.Router();

router.get('/dashboard-summary', admin.dashboardSummary);

router.get('/me', admin.me);
router.patch('/me', admin.updateMe);
router.patch('/me/password', admin.changeMyPassword);

router.get('/organizations', admin.organizations);
router.get('/organizations/:id', admin.organizationDetails);
router.patch('/organizations/:id', admin.updateOrganization);
router.patch('/organizations/:id/suspend', admin.setOrganizationActive(false));
router.patch('/organizations/:id/activate', admin.setOrganizationActive(true));

router.get('/users', admin.users);
router.get('/users/:id', admin.userDetails);
router.patch('/users/:id/block', admin.setUserActive(false));
router.patch('/users/:id/unblock', admin.setUserActive(true));
router.patch('/users/:id/delete-email', admin.deleteUserEmail);
router.patch('/users/:id/restore', admin.restoreUser);
router.delete('/users/:id', admin.deleteUser);

router.get('/teachers', admin.teachers);
router.get('/teachers/:id', admin.teacherDetails);
router.patch('/teachers/:id/pause', admin.pauseTeacher);
router.patch('/teachers/:id/reactivate', admin.reactivateTeacher);
router.patch('/teachers/:id/remove', admin.removeTeacher);

router.get('/students', admin.students);
router.get('/students/:id', admin.studentDetails);

router.get('/services', admin.services);
router.get('/services/:id', admin.serviceDetails);
router.patch('/services/:id/deactivate', admin.setServiceActive(false));
router.patch('/services/:id/reactivate', admin.setServiceActive(true));

router.get('/batches', admin.batches);
router.get('/batches/:id', admin.batchDetails);
router.patch('/batches/:id/deactivate', admin.setBatchActive(false));
router.patch('/batches/:id/reactivate', admin.setBatchActive(true));

router.get('/exams', admin.exams);
router.get('/exams/:id', admin.examDetails);
router.patch('/exams/:id/cancel', admin.cancelExam);

router.get('/submissions', admin.submissions);
router.get('/submissions/:id', admin.submissionDetails);

router.get('/rankings', admin.rankings);

router.get('/plans', admin.plans);
router.post('/plans', admin.createPlan);
router.get('/plans/:id', admin.planDetails);
router.patch('/plans/:id', admin.updatePlan);
router.patch('/plans/:id/activate', admin.activatePlan);
router.patch('/plans/:id/deactivate', admin.deactivatePlan);
router.delete('/plans/:id', admin.deletePlan);

router.get('/subscriptions', admin.subscriptions);
router.get('/subscriptions/:id', admin.subscriptionDetails);
router.patch('/subscriptions/:id', admin.updateSubscription);
router.patch('/subscriptions/:id/change-plan', admin.changeSubscriptionPlan);
router.patch('/subscriptions/:id/cancel', admin.cancelSubscription);
router.patch('/subscriptions/:id/refund', admin.refundSubscription);
router.patch('/subscriptions/:id/extend', admin.extendSubscription);
router.patch('/subscriptions/:id/activate', admin.activateSubscription(true));
router.patch('/subscriptions/:id/deactivate', admin.activateSubscription(false));
router.patch('/subscriptions/:id/note', admin.addSubscriptionNote);

router.get('/payment-requests', admin.paymentRequests);
router.patch('/payment-requests/:id/approve', admin.reviewPaymentRequest('approved'));
router.patch('/payment-requests/:id/reject', admin.reviewPaymentRequest('rejected'));

router.get('/organization-verifications', admin.organizationVerifications);
router.patch('/organization-verifications/:organizationId/approve', admin.approveVerification);
router.patch('/organization-verifications/:organizationId/reject', admin.rejectVerification);

router.get('/teacher-join-requests', admin.teacherJoinRequests);
router.get('/reports', admin.reports);

module.exports = router;
