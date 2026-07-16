const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const customerController = require('../controllers/customerController');

router.get('/', auth, customerController.getCustomers);
router.post('/:id/analyze', auth, customerController.analyzeCustomer);
router.post('/:id/clear', auth, customerController.clearCustomerKnowledge);

module.exports = router;
