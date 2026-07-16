const mongoose = require('mongoose');

const AILogSchema = new mongoose.Schema({
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    organizationContact: { type: mongoose.Schema.Types.ObjectId, ref: 'OrganizationContact', required: true },
    userMessage: { type: String, required: true },
    retrievedChunks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'KnowledgeChunk' }],
    model: { type: String, required: true },
    response: { type: String, required: true },
    tokens: {
        input: { type: Number, default: 0 },
        output: { type: Number, default: 0 }
    },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('AILog', AILogSchema);
