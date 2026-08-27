const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
    account: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Account',
        required: true
    },
    aiEnabled: {
        type: Boolean,
        default: true
    },
    aiConfig: {
        organizationName: { type: String, default: "" },
        personality: { type: String, default: "" },
        behavior: { type: String, default: "" },
        communicationStyle: { type: String, default: "" },
        brandIdentity: { type: String, default: "" }
    },
    customCompanyDetails: [
        {
            key: { type: String, required: true },
            value: { type: String, required: true }
        }
    ],
    customPrompts: [
        {
            title: { type: String, required: true },
            prompt: { type: String, required: true },
            createdAt: { type: Date, default: Date.now }
        }
    ],
    replyMethod: {
        type: String,
        enum: ['menu', 'auto', 'flow', 'ai'],
        default: 'ai'
    },
    flowData: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },
    compiledFlow: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },
    menuStyle: {
        header: { type: String, default: "🛍️ *OUR CATALOG*" },
        itemFormat: { type: String, default: "• *{{name}}*\n  Price: Rs. {{price}}\n  _{{category}}_" },
        footer: { type: String, default: "Type item name or code to order!" }
    },
    menuStyles: [
        {
            id: { type: String, required: true },
            name: { type: String, required: true },
            header: { type: String, default: "🛍️ *OUR CATALOG*" },
            itemFormat: { type: String, default: "• *{{name}}*\n  Price: Rs. {{price}}\n  _{{category}}_" },
            footer: { type: String, default: "Type item name or code to order!" }
        }
    ],
    supportedLanguages: {
        type: [String],
        default: ['en']
    },
    defaultLanguage: {
        type: String,
        default: 'en'
    },
    responseTime: {
        type: Number,
        default: 2000
    },
    typingTime: {
        type: Number,
        default: 3000
    },
    waitingTime: {
        type: Number,
        default: 1000
    },
    sendTyping: {
        type: Boolean,
        default: true
    },
    customCatalogTypes: {
        type: [String],
        default: ['product', 'service']
    },
    itemCardTemplate: {
        type: String,
        default: '🏷️ *{{name}}*\n💰 Price: Rs. {{price}}\n\n📝 {{description}}\n\n📦 {{variants}}\n\n_Status: {{status}}_'
    }
});

module.exports = mongoose.model('Settings', SettingsSchema);
