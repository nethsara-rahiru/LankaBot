const mongoose = require('mongoose');

const ConversationSchema = new mongoose.Schema({
    organizationContact: { type: mongoose.Schema.Types.ObjectId, ref: 'OrganizationContact', required: true },
    summary: { type: String, default: "" },
    status: { type: String, default: 'active', enum: ['active', 'closed'] },
    startedAt: { type: Date, default: Date.now },
    lastMessageAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Conversation', ConversationSchema);
