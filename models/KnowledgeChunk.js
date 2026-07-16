const mongoose = require('mongoose');

const KnowledgeChunkSchema = new mongoose.Schema({
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    title: { type: String, required: true },
    category: { type: String, required: true },
    content: { type: String, required: true },
    embedding: [{ type: Number, required: true }],
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('KnowledgeChunk', KnowledgeChunkSchema);
