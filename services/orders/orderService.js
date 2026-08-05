const mongoose = require('mongoose');
const Order = require('../../models/Order');
const OrderHistory = require('../../models/OrderHistory');
const catalogService = require('../catalog/catalogService');
const { v4: uuidv4 } = require('uuid');

/**
 * Service to manage orders and order history.
 */
class OrderService {
    /**
     * Create a new order with snapshots of catalog items.
     * @param {string} accountId - Organization account ID
     * @param {Object} orderData - { customerId, organizationContactId, items: [{ itemId, quantity, customSnapshot }], customFields, status }
     */
    async createOrder(accountId, orderData) {
        if (!accountId) throw new Error('accountId is required for organization isolation');

        console.log('[OrderService] createOrder called — accountId:', accountId);
        console.log('[OrderService] orderData received:', JSON.stringify(orderData));

        const orderId = orderData.orderId || `ORD-${uuidv4().substring(0, 8).toUpperCase()}`;

        // Build item snapshots
        const itemsWithSnapshots = await Promise.all((orderData.items || []).map(async (item) => {
            let snapshot = item.customSnapshot || {};

            // If itemId is provided, fetch the current catalog item dynamic fields as snapshot
            if (item.itemId) {
                try {
                    const catalogItem = await catalogService.getItemById(accountId, item.itemId);
                    if (catalogItem) {
                        snapshot = {
                            type: catalogItem.type,
                            status: catalogItem.status,
                            ...catalogItem.fields,
                            ...snapshot // custom overrides if any
                        };
                    }
                } catch (err) {
                    console.error(`[OrderService] Failed to load catalog item snapshot for ${item.itemId}:`, err);
                }
            }

            return {
                itemId: item.itemId || null,
                snapshot,
                quantity: item.quantity || 1
            };
        }));

        console.log('[OrderService] itemsWithSnapshots:', JSON.stringify(itemsWithSnapshots));

        // Accept 'customer' or 'customerId', and 'organizationContact' or 'organizationContactId'
        let customerVal = orderData.customerId || orderData.customer || null;
        let contactVal = orderData.organizationContactId || orderData.organizationContact || null;

        // Ensure customer and organizationContact are valid Mongo ObjectIds (if string/name passed, store in customFields instead)
        if (customerVal && !mongoose.Types.ObjectId.isValid(customerVal)) {
            if (!orderData.customFields) orderData.customFields = {};
            if (!orderData.customFields.customerName) {
                orderData.customFields.customerName = customerVal;
            }
            customerVal = null;
        }

        if (contactVal && !mongoose.Types.ObjectId.isValid(contactVal)) {
            contactVal = null;
        }

        const newOrder = new Order({
            orderId,
            account: accountId,
            organizationContact: contactVal,
            customer: customerVal,
            items: itemsWithSnapshots,
            customFields: orderData.customFields || {},
            status: orderData.status || 'received',
            paymentStatus: orderData.paymentStatus || 'unpaid',
            delivery: orderData.delivery || {}
        });

        console.log('[OrderService] Saving order to DB:', JSON.stringify(newOrder.toObject ? newOrder.toObject() : newOrder));

        const savedOrder = await newOrder.save();
        console.log('[OrderService] ✅ Order saved. _id:', savedOrder._id, '| orderId:', savedOrder.orderId);

        // Record initial history record
        await this.recordHistory(accountId, orderId, [{
            field: 'status',
            oldValue: null,
            newValue: savedOrder.status,
            source: orderData.source || 'flow'
        }]);

        return savedOrder;
    }

    /**
     * Update order status with audit log.
     * @param {string} accountId 
     * @param {string} orderId 
     * @param {string} newStatus 
     * @param {string} [source='admin'] 
     */
    async updateOrderStatus(accountId, orderId, newStatus, source = 'admin') {
        if (!accountId) throw new Error('accountId is required');

        const existingOrder = await Order.findOne({ orderId, account: accountId });
        if (!existingOrder) throw new Error(`Order ${orderId} not found`);

        const oldStatus = existingOrder.status;
        if (oldStatus === newStatus) return existingOrder;

        existingOrder.status = newStatus;
        const updatedOrder = await existingOrder.save();

        await this.recordHistory(accountId, orderId, [{
            field: 'status',
            oldValue: oldStatus,
            newValue: newStatus,
            source
        }]);

        return updatedOrder;
    }

    /**
     * Update order details (customFields, paymentStatus, delivery, items).
     * @param {string} accountId 
     * @param {string} orderId 
     * @param {Object} updateData 
     */
    async updateOrder(accountId, orderId, updateData) {
        if (!accountId) throw new Error('accountId is required');

        const existingOrder = await Order.findOne({ orderId, account: accountId });
        if (!existingOrder) throw new Error(`Order ${orderId} not found`);

        const changes = [];

        if (updateData.customFields) {
            existingOrder.customFields = { ...existingOrder.customFields, ...updateData.customFields };
            changes.push({ field: 'customFields', oldValue: 'updated', newValue: 'updated', source: 'admin' });
        }
        if (updateData.paymentStatus && updateData.paymentStatus !== existingOrder.paymentStatus) {
            changes.push({ field: 'paymentStatus', oldValue: existingOrder.paymentStatus, newValue: updateData.paymentStatus, source: 'admin' });
            existingOrder.paymentStatus = updateData.paymentStatus;
        }
        if (updateData.status && updateData.status !== existingOrder.status) {
            changes.push({ field: 'status', oldValue: existingOrder.status, newValue: updateData.status, source: 'admin' });
            existingOrder.status = updateData.status;
        }
        if (updateData.items) {
            existingOrder.items = updateData.items;
            changes.push({ field: 'items', oldValue: 'updated', newValue: 'updated', source: 'admin' });
        }
        if (updateData.delivery) {
            existingOrder.delivery = updateData.delivery;
        }

        const updatedOrder = await existingOrder.save();

        if (changes.length > 0) {
            await this.recordHistory(accountId, orderId, changes);
        }

        return updatedOrder;
    }

    /**
     * Get orders for an organization.
     * @param {string} accountId 
     * @param {Object} [filter={}] 
     */
    async getOrders(accountId, filter = {}) {
        if (!accountId) throw new Error('accountId is required');
        return await Order.find({ account: accountId, ...filter }).sort({ createdAt: -1 });
    }

    /**
     * Get order history audit trail.
     * @param {string} accountId 
     * @param {string} orderId 
     */
    async getOrderHistory(accountId, orderId) {
        if (!accountId) throw new Error('accountId is required');
        return await OrderHistory.findOne({ orderId, account: accountId });
    }

    /**
     * Internal helper to append audit log changes.
     */
    async recordHistory(accountId, orderId, changes) {
        try {
            await OrderHistory.findOneAndUpdate(
                { orderId, account: accountId },
                {
                    $push: { changes: { $each: changes } }
                },
                { upsert: true, new: true }
            );
        } catch (err) {
            console.error(`[OrderService] Failed to record history for ${orderId}:`, err);
        }
    }
}

module.exports = new OrderService();
