const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
    orderId: { type: String, required: true, unique: true, index: true },
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    organizationContact: { type: mongoose.Schema.Types.ObjectId, ref: 'OrganizationContact', required: false },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: false },
    items: [{
        itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'CatalogItem', required: false },
        snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
        quantity: { type: Number, required: true, default: 1 }
    }],
    customFields: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, default: 'received' },
    paymentStatus: { type: String, default: 'unpaid' },
    delivery: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

OrderSchema.pre('save', function() {
    this.updatedAt = Date.now();
});

OrderSchema.index({ account: 1, orderId: 1 });

module.exports = mongoose.model('Order', OrderSchema);
