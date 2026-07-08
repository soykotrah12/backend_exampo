const express = require('express');
const admin = require('../controllers/adminController');

const router = express.Router();

router.get('/dashboard-summary', admin.dashboardSummary);

router.get('/organizations', admin.organizations);
router.get('/organizations/:id', admin.organizationDetails);
router.patch('/organizations/:id', admin.updateOrganization);
router.patch('/organizations/:id/suspend', admin.setOrganizationActive(false));
router.patch('/organizations/:id/activate', admin.setOrganizationActive(true));

router.get('/users', admin.users);
router.get('/users/:id', admin.userDetails);
router.patch('/users/:id/block', admin.setUserActive(false));
router.patch('/users/:id/unblock', admin.setUserActive(true));

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
router.patch('/plans/:id', admin.updatePlan);
router.patch('/plans/:id/deactivate', admin.deactivatePlan);

router.get('/subscriptions', admin.subscriptions);
router.patch('/subscriptions/:id', admin.updateSubscription);

router.get('/payment-requests', admin.paymentRequests);
router.patch('/payment-requests/:id/approve', admin.reviewPaymentRequest('approved'));
router.patch('/payment-requests/:id/reject', admin.reviewPaymentRequest('rejected'));

router.get('/organization-verifications', admin.organizationVerifications);
router.patch('/organization-verifications/:organizationId/approve', admin.approveVerification);
router.patch('/organization-verifications/:organizationId/reject', admin.rejectVerification);

router.get('/teacher-join-requests', admin.teacherJoinRequests);
router.get('/reports', admin.reports);

module.exports = router;
