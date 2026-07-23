const User = require('../models/User');

module.exports = async function(req, res, next) {
    try {
        // req.user is set by the auth middleware
        if (!req.user || !req.user.id) {
            return res.status(401).json({ msg: 'Not authorized, no user found' });
        }

        const user = await User.findById(req.user.id);
        
        if (!user) {
            return res.status(404).json({ msg: 'User not found' });
        }

        if (user.role !== 'admin') {
            return res.status(403).json({ msg: 'Access denied. Admin privileges required.' });
        }

        next();
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server Error in admin middleware' });
    }
};
