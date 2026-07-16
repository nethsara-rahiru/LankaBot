const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    organizationContact: { type: mongoose.Schema.Types.ObjectId, ref: 'OrganizationContact', required: true },
    products: [{ type: mongoose.Schema.Types.Mixed }],
    status: { type: String, default: 'pending' },
    paymentStatus: { type: String, default: 'unpaid' },
    delivery: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Order', OrderSchema);
