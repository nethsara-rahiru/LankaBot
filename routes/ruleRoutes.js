const express = require('express');
const router = express.Router();
const Rule = require('../models/Rule');

// Get all rules
router.get('/', async (req, res) => {
    try {
        const rules = await Rule.find().sort({ createdAt: -1 });
        res.json(rules);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Create a rule
router.post('/', async (req, res) => {
    const rule = new Rule({
        trigger: req.body.trigger,
        matchType: req.body.matchType || 'contains',
        startTime: req.body.startTime || null,
        endTime: req.body.endTime || null,
        reply: req.body.reply
    });

    if (req.body.matchType === 'regex') {
        try {
            new RegExp(req.body.trigger);
        } catch (e) {
            return res.status(400).json({ message: 'Invalid Regex pattern' });
        }
    }

    try {
        const newRule = await rule.save();
        res.status(201).json(newRule);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// Update a rule
router.patch('/:id', async (req, res) => {
    try {
        const rule = await Rule.findById(req.params.id);
        if (req.body.trigger) rule.trigger = req.body.trigger;
        if (req.body.matchType) rule.matchType = req.body.matchType;
        if (req.body.startTime !== undefined) rule.startTime = req.body.startTime;
        if (req.body.endTime !== undefined) rule.endTime = req.body.endTime;
        if (req.body.reply) rule.reply = req.body.reply;
        if (req.body.active !== undefined) rule.active = req.body.active;
        
        if (req.body.matchType === 'regex' || (rule.matchType === 'regex' && req.body.trigger)) {
            try {
                new RegExp(req.body.trigger || rule.trigger);
            } catch (e) {
                return res.status(400).json({ message: 'Invalid Regex pattern' });
            }
        }

        const updatedRule = await rule.save();
        res.json(updatedRule);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// Delete a rule
router.delete('/:id', async (req, res) => {
    try {
        await Rule.findByIdAndDelete(req.params.id);
        res.json({ message: 'Rule deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
