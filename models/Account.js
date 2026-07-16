const mongoose = require('mongoose');

const AccountSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true
    },
    organizationName: {
        type: String,
        required: true
    },
    phoneNumber: {
        type: String,
        required: false
    },
    pushName: {
        type: String,
        required: false
    },
    profilePic: {
        type: String,
        default: ''
    },
    sessionId: {
        type: String,
        required: true,
        unique: true
    },
    status: {
        type: String,
        enum: ['disconnected', 'connecting', 'ready', 'qr'],
        default: 'disconnected'
    },
    lastQR: {
        type: String,
        default: null
    },
    paused: {
        type: Boolean,
        default: false
    },
    date: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Account', AccountSchema);
