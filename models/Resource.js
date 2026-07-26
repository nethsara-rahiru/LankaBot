const mongoose = require('mongoose');

const ResourceSchema = new mongoose.Schema({
    ownerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true
    },
    originalName: {
        type: String,
        required: true
    },
    storedName: {
        type: String,
        required: true,
        unique: true
    },
    hash: {
        type: String,
        required: true,
        index: true
    },
    type: {
        type: String, // e.g., 'image', 'video', 'pdf', 'audio', 'document'
        required: true
    },
    mimeType: {
        type: String,
        required: true
    },
    extension: {
        type: String,
        required: true
    },
    size: {
        type: Number, // size in bytes
        required: true
    },
    folderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Folder',
        default: null
    },
    uploadDate: {
        type: Date,
        default: Date.now
    },
    modifiedDate: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Resource', ResourceSchema);
