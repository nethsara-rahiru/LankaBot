const mongoose = require('mongoose');

const RuleSchema = new mongoose.Schema({
    account: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Account',
        required: true
    },
    trigger: { 
        type: String, 
        required: true, 
        trim: true,
        lowercase: true
    },
    matchType: {
        type: String,
        enum: ['contains', 'exact', 'startsWith', 'endsWith', 'regex', 'fuzzy'],
        default: 'contains'
    },
    startTime: {
        type: String, // HH:mm format
        default: null
    },
    endTime: {
        type: String, // HH:mm format
        default: null
    },
    reply: { 
        type: String, 
        required: true 
    },
    active: { 
        type: Boolean, 
        default: true 
    },
    createdAt: { 
        type: Date, 
        default: Date.now 
    }
});

module.exports = mongoose.model('Rule', RuleSchema);
