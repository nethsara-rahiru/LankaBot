const Settings = require('../models/Settings');

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
        
        if (req.body.aiEnabled !== undefined) settings.aiEnabled = req.body.aiEnabled;
        if (req.body.aiSystemPrompt !== undefined) settings.aiSystemPrompt = req.body.aiSystemPrompt;
        if (req.body.responseTime !== undefined) settings.responseTime = req.body.responseTime;
        if (req.body.typingTime !== undefined) settings.typingTime = req.body.typingTime;
        if (req.body.waitingTime !== undefined) settings.waitingTime = req.body.waitingTime;
        if (req.body.knowledgeBase !== undefined) settings.knowledgeBase = req.body.knowledgeBase;
        if (req.body.aiPersonality !== undefined) settings.aiPersonality = req.body.aiPersonality;
        if (req.body.aiBehavior !== undefined) settings.aiBehavior = req.body.aiBehavior;
        if (req.body.aiDecisionMaking !== undefined) settings.aiDecisionMaking = req.body.aiDecisionMaking;
        if (req.body.aiCommunicationStyle !== undefined) settings.aiCommunicationStyle = req.body.aiCommunicationStyle;
        if (req.body.aiBrandIdentity !== undefined) settings.aiBrandIdentity = req.body.aiBrandIdentity;
        settings.updatedAt = Date.now();
        
        const updatedSettings = await settings.save();
        res.json(updatedSettings);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};
