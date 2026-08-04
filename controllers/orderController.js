const orderService = require('../services/orders/orderService');

class OrderController {
    async getOrders(req, res) {
        try {
            const accountId = req.header('x-account-id');
            if (!accountId) return res.status(400).json({ msg: 'x-account-id header required' });

            const filter = {};
            if (req.query.status) filter.status = req.query.status;

            const orders = await orderService.getOrders(accountId, filter);
            res.json(orders);
        } catch (err) {
            console.error('Error fetching orders:', err);
            res.status(500).json({ msg: 'Server error', error: err.message });
        }
    }

    async createOrder(req, res) {
        try {
            const accountId = req.header('x-account-id');
            if (!accountId) return res.status(400).json({ msg: 'x-account-id header required' });

            const order = await orderService.createOrder(accountId, {
                ...req.body,
                source: 'admin'
            });
            res.status(201).json(order);
        } catch (err) {
            console.error('Error creating order:', err);
            res.status(500).json({ msg: 'Server error', error: err.message });
        }
    }

    async updateStatus(req, res) {
        try {
            const accountId = req.header('x-account-id');
            if (!accountId) return res.status(400).json({ msg: 'x-account-id header required' });

            const { status } = req.body;
            if (!status) return res.status(400).json({ msg: 'Status is required' });

            const order = await orderService.updateOrderStatus(accountId, req.params.orderId, status, 'admin');
            res.json(order);
        } catch (err) {
            console.error('Error updating order status:', err);
            res.status(500).json({ msg: 'Server error', error: err.message });
        }
    }

    async updateOrder(req, res) {
        try {
            const accountId = req.header('x-account-id');
            if (!accountId) return res.status(400).json({ msg: 'x-account-id header required' });

            const updatedOrder = await orderService.updateOrder(accountId, req.params.orderId, req.body);
            res.json(updatedOrder);
        } catch (err) {
            console.error('Error updating order:', err);
            res.status(500).json({ msg: 'Server error', error: err.message });
        }
    }

    async getHistory(req, res) {
        try {
            const accountId = req.header('x-account-id');
            if (!accountId) return res.status(400).json({ msg: 'x-account-id header required' });

            const history = await orderService.getOrderHistory(accountId, req.params.orderId);
            res.json(history || { orderId: req.params.orderId, changes: [] });
        } catch (err) {
            console.error('Error fetching order history:', err);
            res.status(500).json({ msg: 'Server error', error: err.message });
        }
    }
}

module.exports = new OrderController();
