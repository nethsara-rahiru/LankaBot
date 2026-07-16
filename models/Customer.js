const mongoose = require('mongoose');

const FactSchema = new mongoose.Schema({
    text: { type: String, required: true },
    category: { type: String, required: true, enum: ['profile', 'preference', 'general'] },
    confidence: { type: Number, default: 1 },
    createdAt: { type: Date, default: Date.now }
});

const CustomerSchema = new mongoose.Schema({
    phoneNumber: { type: String, required: true, unique: true },
    name: { type: String, default: "" },
    email: { type: String, default: "" },
    globalProfile: {
        preferredLanguage: { type: String, default: "auto" },
        location: { type: String, default: "" },
        communicationStyle: { type: String, default: "" }
    },
    globalPreferences: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
    globalFacts: [FactSchema],
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Customer', CustomerSchema);
