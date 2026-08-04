const mongoose = require('mongoose');

const CatalogItemSchema = new mongoose.Schema({
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    type: { type: String, enum: ['product', 'service'], required: true },
    fields: { type: mongoose.Schema.Types.Mixed, required: true, default: {} },
    status: { type: String, default: 'available' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

CatalogItemSchema.pre('save', function() {
    this.updatedAt = Date.now();
});

CatalogItemSchema.index({ account: 1, type: 1 });
CatalogItemSchema.index({ account: 1, status: 1 });

module.exports = mongoose.model('CatalogItem', CatalogItemSchema);
