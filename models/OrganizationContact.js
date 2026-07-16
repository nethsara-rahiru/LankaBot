const mongoose = require('mongoose');

const FactSchema = new mongoose.Schema({
    text: { type: String, required: true },
    category: { type: String, required: true },
    confidence: { type: Number, default: 1 },
    createdAt: { type: Date, default: Date.now }
});

const OrganizationContactSchema = new mongoose.Schema({
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    organizationProfile: {
        summary: { type: String, default: "" },
        facts: [FactSchema],
        tags: [{ type: String }],
        customerType: { type: String, default: "" }
    },
    lastMessageAt: { type: Date, default: Date.now },
    lastAnalyzedAt: { type: Date, default: null }
});

module.exports = mongoose.model('OrganizationContact', OrganizationContactSchema);
