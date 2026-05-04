const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
    aiEnabled: {
        type: Boolean,
        default: true
    },
    aiSystemPrompt: {
        type: String,
        default: "You are LankaBot, a professional AI assistant. Keep your responses helpful, concise, and professional. Use emojis sparingly but appropriately."
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Settings', SettingsSchema);
