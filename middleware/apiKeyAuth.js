const User = require('../models/User');

module.exports = async function(req, res, next) {
    try {
        // Extract API key from header, query parameter, or request body
        const apiKey = req.header('x-api-key') ||
            (req.header('Authorization') && req.header('Authorization').startsWith('Bearer ') ? req.header('Authorization').split(' ')[1] : null) ||
            req.query.apiKey ||
            req.body.apiKey;

        if (!apiKey) {
            return res.status(401).json({ msg: 'No API key provided. Include x-api-key header or apiKey field.' });
        }

        // Find user associated with this API key
        const user = await User.findOne({ apiKey });

        if (!user) {
            return res.status(401).json({ msg: 'Invalid API key provided.' });
        }

        if (user.status === 'blocked') {
            return res.status(403).json({ msg: 'User account is blocked.' });
        }

        req.user = {
            id: user._id.toString(),
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            assignedAccounts: user.assignedAccounts
        };

        next();
    } catch (err) {
        console.error('API Key Auth Error:', err.message);
        return res.status(500).json({ msg: 'Server error during API key authentication', error: err.message });
    }
};
