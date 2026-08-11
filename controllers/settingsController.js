const Settings = require('../models/Settings');
const { getPromptTemplate, getPromptScripts } = require('../utils/groq');
const { resetActiveFlows } = require('../bot/whatsapp');

// @desc    Get settings for specific account
// @route   GET /api/settings
// @access  Private
exports.getSettings = async (req, res) => {
    try {
        const accountId = req.header('x-account-id');
        if (!accountId) return res.status(400).json({ message: 'Account ID required' });

        let settings = await Settings.findOne({ account: accountId });
        if (!settings) {
            settings = new Settings({ account: accountId });
            await settings.save();
        }
        res.json(settings);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// @desc    Get the compiled system prompt from AI scripts
// @route   GET /api/settings/compiled-prompt
// @access  Private
exports.getCompiledPrompt = (req, res) => {
    try {
        const template = getPromptTemplate();
        res.json({ prompt: template });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// @desc    Get individual AI script files
// @route   GET /api/settings/prompt-scripts
// @access  Private
exports.getPromptScriptsEndpoint = (req, res) => {
    try {
        const scripts = getPromptScripts();
        res.json(scripts);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// @desc    Update settings for specific account
// @route   PATCH /api/settings
// @access  Private
exports.updateSettings = async (req, res) => {
    try {
        const accountId = req.header('x-account-id');
        if (!accountId) return res.status(400).json({ message: 'Account ID required' });

        let settings = await Settings.findOne({ account: accountId });
        if (!settings) {
            settings = new Settings({ account: accountId });
        }
        
        if (req.body.responseTime !== undefined) settings.responseTime = req.body.responseTime;
        if (req.body.typingTime !== undefined) settings.typingTime = req.body.typingTime;
        if (req.body.waitingTime !== undefined) settings.waitingTime = req.body.waitingTime;

        if (req.body.aiEnabled !== undefined) settings.aiEnabled = req.body.aiEnabled;
        
        if (req.body.aiConfig) {
            if (!settings.aiConfig) settings.aiConfig = {};
            if (req.body.aiConfig.organizationName !== undefined) settings.aiConfig.organizationName = req.body.aiConfig.organizationName;
            if (req.body.aiConfig.personality !== undefined) settings.aiConfig.personality = req.body.aiConfig.personality;
            if (req.body.aiConfig.behavior !== undefined) settings.aiConfig.behavior = req.body.aiConfig.behavior;
            if (req.body.aiConfig.communicationStyle !== undefined) settings.aiConfig.communicationStyle = req.body.aiConfig.communicationStyle;
            if (req.body.aiConfig.brandIdentity !== undefined) settings.aiConfig.brandIdentity = req.body.aiConfig.brandIdentity;
        }
        
        if (req.body.customCompanyDetails !== undefined) {
            settings.customCompanyDetails = req.body.customCompanyDetails;
        }

        if (req.body.replyMethod !== undefined) {
            settings.replyMethod = req.body.replyMethod;
        }

        if (req.body.flowData !== undefined) {
            settings.flowData = req.body.flowData;
            settings.markModified('flowData');
        }

        if (req.body.compiledFlow !== undefined) {
            settings.compiledFlow = req.body.compiledFlow;
            settings.markModified('compiledFlow');
        }

        if (req.body.supportedLanguages !== undefined) {
            settings.supportedLanguages = req.body.supportedLanguages;
            settings.markModified('supportedLanguages');
        }

        if (req.body.defaultLanguage !== undefined) {
            settings.defaultLanguage = req.body.defaultLanguage;
        }

        if (req.body.menuStyle !== undefined) {
            settings.menuStyle = req.body.menuStyle;
            settings.markModified('menuStyle');
        }

        if (req.body.customCatalogTypes !== undefined) {
            settings.customCatalogTypes = req.body.customCatalogTypes;
            settings.markModified('customCatalogTypes');
        }
        
        const updatedSettings = await settings.save();
        res.json(updatedSettings);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

// @desc    Get all custom prompts for account
// @route   GET /api/settings/custom-prompts
// @access  Private
exports.getCustomPrompts = async (req, res) => {
    try {
        const accountId = req.header('x-account-id');
        if (!accountId) return res.status(400).json({ message: 'Account ID required' });

        let settings = await Settings.findOne({ account: accountId });
        if (!settings) {
            settings = new Settings({ account: accountId });
            await settings.save();
        }
        res.json(settings.customPrompts || []);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// @desc    Add a custom prompt
// @route   POST /api/settings/custom-prompts
// @access  Private
exports.addCustomPrompt = async (req, res) => {
    try {
        const accountId = req.header('x-account-id');
        if (!accountId) return res.status(400).json({ message: 'Account ID required' });

        const { title, prompt } = req.body;
        if (!title || !prompt) return res.status(400).json({ message: 'Title and prompt are required' });

        let settings = await Settings.findOne({ account: accountId });
        if (!settings) settings = new Settings({ account: accountId });

        settings.customPrompts.push({ title, prompt });
        settings.updatedAt = Date.now();
        await settings.save();

        res.status(201).json(settings.customPrompts);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

// @desc    Delete a custom prompt by ID
// @route   DELETE /api/settings/custom-prompts/:promptId
// @access  Private
exports.deleteCustomPrompt = async (req, res) => {
    try {
        const accountId = req.header('x-account-id');
        if (!accountId) return res.status(400).json({ message: 'Account ID required' });

        const settings = await Settings.findOne({ account: accountId });
        if (!settings) return res.status(404).json({ message: 'Settings not found' });

        settings.customPrompts = settings.customPrompts.filter(
            p => p._id.toString() !== req.params.promptId
        );
        settings.updatedAt = Date.now();
        await settings.save();

        res.json(settings.customPrompts);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

// @desc    Reset all active flows for an account
// @route   POST /api/settings/reset-flows
// @access  Private
exports.resetFlows = async (req, res) => {
    try {
        const accountId = req.header('x-account-id');
        if (!accountId) return res.status(400).json({ message: 'Account ID required' });

        await resetActiveFlows(accountId);
        res.json({ message: 'Flows reset successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
