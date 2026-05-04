const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');

// Get settings
router.get('/', async (req, res) => {
    try {
        let settings = await Settings.findOne();
        if (!settings) {
            settings = new Settings();
            await settings.save();
        }
        res.json(settings);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Update settings
router.patch('/', async (req, res) => {
    try {
        let settings = await Settings.findOne();
        if (!settings) {
            settings = new Settings();
        }
        
        if (req.body.aiEnabled !== undefined) settings.aiEnabled = req.body.aiEnabled;
        if (req.body.aiSystemPrompt !== undefined) settings.aiSystemPrompt = req.body.aiSystemPrompt;
        settings.updatedAt = Date.now();
        
        const updatedSettings = await settings.save();
        res.json(updatedSettings);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

module.exports = router;
