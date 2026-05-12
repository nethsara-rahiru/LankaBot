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
    aiSystemPrompt: {
        type: String,
        default: "You are LankaBot, a professional AI assistant. Keep your responses helpful, concise, and professional. Use emojis sparingly but appropriately."
    },
    responseTime: {
        type: Number,
        default: 2000 // 2 seconds
    },
    typingTime: {
        type: Number,
        default: 3000 // 3 seconds
    },
    waitingTime: {
        type: Number,
        default: 1000 // 1 second
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Settings', SettingsSchema);
