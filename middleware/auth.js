const jwt = require('jsonwebtoken');

module.exports = function(req, res, next) {
    // Get token from header or query string (for media downloads)
    const token = req.header('x-auth-token') || req.header('Authorization')?.split(' ')[1] || req.query.token;

    // Check if not token
    if (!token) {
        return res.status(401).json({ msg: 'No token, authorization denied' });
    }

    // Verify token
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ msg: 'Token is not valid' });
    }
};
