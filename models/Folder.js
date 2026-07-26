const mongoose = require('mongoose');

const FolderSchema = new mongoose.Schema({
    ownerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true
    },
    name: {
        type: String,
        required: true
    },
    parentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Folder',
        default: null
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Ensure folder names are unique within the same parent folder for the same user
FolderSchema.index({ ownerId: 1, parentId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Folder', FolderSchema);
