const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const auth = require('../middleware/auth');

router.get('/', auth, orderController.getOrders);
router.post('/', auth, orderController.createOrder);
router.put('/:orderId', auth, orderController.updateOrder);
router.patch('/:orderId/status', auth, orderController.updateStatus);
router.get('/:orderId/history', auth, orderController.getHistory);

module.exports = router;
