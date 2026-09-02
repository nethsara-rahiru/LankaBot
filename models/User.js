const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        required: true
    },
    sessionID: {
        type: String,
        default: null
    },
    lastLogin: {
        type: Date,
        default: null
    },
    role: {
        type: String,
        enum: ['user', 'admin', 'manager', 'analyzer'],
        default: 'user'
    },
    status: {
        type: String,
        enum: ['active', 'blocked'],
        default: 'active'
    },
    assignedAccounts: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Account'
    }],
    apiKey: {
        type: String,
        unique: true,
        sparse: true,
        default: null
    },
    date: {
        type: Date,
        default: Date.now
    }
});

// Hash password before saving
UserSchema.pre('save', async function() {
    if (!this.isModified('password')) {
        return;
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
});

// Compare password method
UserSchema.methods.comparePassword = async function(enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('user', UserSchema);
