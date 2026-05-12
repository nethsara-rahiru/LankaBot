const Rule = require('../models/Rule');

// @desc    Get all rules for specific account
// @route   GET /api/rules
// @access  Private
exports.getRules = async (req, res) => {
    try {
        const accountId = req.header('x-account-id');
        if (!accountId) return res.status(400).json({ message: 'Account ID required' });
        
        const rules = await Rule.find({ account: accountId }).sort({ createdAt: -1 });
        res.json(rules);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// @desc    Create a rule for specific account
// @route   POST /api/rules
// @access  Private
exports.createRule = async (req, res) => {
    const accountId = req.header('x-account-id');
    if (!accountId) return res.status(400).json({ message: 'Account ID required' });

    const rule = new Rule({
        account: accountId,
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
};

// @desc    Update a rule
// @route   PATCH /api/rules/:id
// @access  Private
exports.updateRule = async (req, res) => {
    try {
        const rule = await Rule.findById(req.params.id);
        if (!rule) return res.status(404).json({ message: 'Rule not found' });

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
};

// @desc    Delete a rule
// @route   DELETE /api/rules/:id
// @access  Private
exports.deleteRule = async (req, res) => {
    try {
        await Rule.findByIdAndDelete(req.params.id);
        res.json({ message: 'Rule deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
