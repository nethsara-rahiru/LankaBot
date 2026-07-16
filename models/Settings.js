const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
    account: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Account',
        required: true
    },
    aiEnabled: {
        type: Boolean,
        default: true
    },
    aiConfig: {
        organizationName: { type: String, default: "" },
        personality: { type: String, default: "" },
        behavior: { type: String, default: "" },
        communicationStyle: { type: String, default: "" },
        brandIdentity: { type: String, default: "" }
    },
    customPrompts: [
        {
            title: { type: String, required: true },
            prompt: { type: String, required: true },
            createdAt: { type: Date, default: Date.now }
        }
    ]
});

module.exports = mongoose.model('Settings', SettingsSchema);
