const mongoose = require('mongoose');

const ChangeItemSchema = new mongoose.Schema({
    field: { type: String, required: true },
    oldValue: { type: mongoose.Schema.Types.Mixed },
    newValue: { type: mongoose.Schema.Types.Mixed },
    source: { type: String, required: true, default: 'system' }, // e.g. flow, admin, api, ai
    timestamp: { type: Date, default: Date.now }
}, { _id: false });

const OrderHistorySchema = new mongoose.Schema({
    orderId: { type: String, required: true, index: true },
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    changes: [ChangeItemSchema],
    createdAt: { type: Date, default: Date.now }
});

OrderHistorySchema.index({ account: 1, orderId: 1 });

module.exports = mongoose.model('OrderHistory', OrderHistorySchema);
