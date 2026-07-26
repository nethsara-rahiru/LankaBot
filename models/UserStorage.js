const mongoose = require('mongoose');

const UserStorageSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true,
        unique: true
    },
    limit: {
        type: Number,
        default: 104857600 // Default: 100 MB in bytes
    },
    used: {
        type: Number,
        default: 0 // Used storage in bytes
    },
    lastUpdated: {
        type: Date,
        default: Date.now
    }
});

// Update the lastUpdated timestamp before saving
UserStorageSchema.pre('save', async function() {
    this.lastUpdated = Date.now();
});

module.exports = mongoose.model('UserStorage', UserStorageSchema);
