const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const customerController = require('../controllers/customerController');

router.get('/', auth, customerController.getCustomers);
router.get('/:id/messages', auth, customerController.getMessages);
router.post('/:id/analyze', auth, customerController.analyzeCustomer);
router.post('/:id/clear', auth, customerController.clearCustomerKnowledge);
router.post('/:id/reset-flow', auth, customerController.resetFlow);

module.exports = router;
