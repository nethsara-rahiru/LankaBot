const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
    organizationContact: { type: mongoose.Schema.Types.ObjectId, ref: 'OrganizationContact', required: true },
    role: { type: String, required: true, enum: ['user', 'bot', 'system'] },
    content: { type: String, required: true },
    messageType: { type: String, default: 'text' },
    timestamp: { type: Date, default: Date.now },
    aiMetadata: {
        model: { type: String, default: "" },
        inputTokens: { type: Number, default: 0 },
        outputTokens: { type: Number, default: 0 },
        responseTime: { type: Number, default: 0 }
    }
});

module.exports = mongoose.model('Message', MessageSchema);
