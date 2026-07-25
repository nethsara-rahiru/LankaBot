const User = require('../models/User');
const jwt = require('jsonwebtoken');

// @route   GET api/users
// @desc    Get all users
// @access  Public
exports.getUsers = async (req, res) => {
    try {
        const users = await User.find().select('-password');
        res.json(users);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @route   POST api/users/register
// @desc    Register a user
// @access  Public
exports.registerUser = async (req, res) => {
    const { name, email, password } = req.body;

    try {
        let user = await User.findOne({ email });

        if (user) {
            return res.status(400).json({ msg: 'User already exists' });
        }

        user = new User({
            name,
            email,
            password
        });

        // Create token BEFORE saving so we can save it with the user in one go
        const token = jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET || 'secret', { expiresIn: '30d' });
        
        if (email === 'rahiru123@gmail.com') {
            user.role = 'admin';
        }

        user.sessionID = token;
        user.lastLogin = Date.now();

        await user.save();

        res.json({
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email
            }
        });
    } catch (err) {
        console.error('Registration Error:', err);
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};

// @route   POST api/users/login
// @desc    Authenticate user & get token
// @access  Public
exports.loginUser = async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = await User.findOne({ email });

        if (!user) {
            return res.status(400).json({ msg: 'Invalid Credentials' });
        }

        const isMatch = await user.comparePassword(password);

        if (!isMatch) {
            return res.status(400).json({ msg: 'Invalid Credentials' });
        }

        // Create token
        const token = jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET || 'secret', { expiresIn: '30d' });

        if (email === 'rahiru123@gmail.com' && user.role !== 'admin') {
            user.role = 'admin';
        }

        // Update session in DB
        user.sessionID = token;
        user.lastLogin = Date.now();
        await user.save();

        res.json({
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email
            }
        });
    } catch (err) {
        console.error('Login Error:', err);
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};

// @route   PUT api/users/profile
// @desc    Update user profile
// @access  Private
exports.updateProfile = async (req, res) => {
    const { name, email, password } = req.body;

    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        if (name) user.name = name;
        if (email) {
            // Check if email is already taken by another user
            const existingUser = await User.findOne({ email });
            if (existingUser && existingUser._id.toString() !== req.user.id) {
                return res.status(400).json({ msg: 'Email is already in use' });
            }
            user.email = email;
        }
        if (password) user.password = password;

        await user.save();

        res.json({
            msg: 'Profile updated successfully',
            user: {
                id: user._id,
                name: user.name,
                email: user.email
            }
        });
    } catch (err) {
        console.error('Update Profile Error:', err);
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};

// --- Admin Endpoints ---

// @route   GET api/users/admin
// @desc    Get all users with their assigned accounts
// @access  Private/Admin
exports.getAllUsersAdmin = async (req, res) => {
    try {
        const users = await User.find().select('-password').populate('assignedAccounts');
        res.json(users);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @route   PUT api/users/admin/:id/role
// @desc    Update a user's role
// @access  Private/Admin
exports.updateUserRole = async (req, res) => {
    try {
        const { role } = req.body;
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        user.role = role;
        await user.save();
        res.json({ msg: 'User role updated', user });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @route   PUT api/users/admin/:id/status
// @desc    Update a user's status (active/blocked)
// @access  Private/Admin
exports.updateUserStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        user.status = status;
        if (status === 'blocked') {
            user.sessionID = null; // force logout
        }
        await user.save();
        res.json({ msg: 'User status updated', user });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @route   DELETE api/users/admin/:id
// @desc    Delete a user
// @access  Private/Admin
exports.deleteUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        await user.deleteOne();
        res.json({ msg: 'User removed' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @route   POST api/users/admin/:id/accounts
// @desc    Assign an account to a user
// @access  Private/Admin
exports.assignAccount = async (req, res) => {
    try {
        const { accountId } = req.body;
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        if (!user.assignedAccounts.some(id => id.toString() === accountId)) {
            user.assignedAccounts.push(accountId);
            await user.save();
        }
        
        res.json({ msg: 'Account assigned', user });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @route   DELETE api/users/admin/:id/accounts/:accountId
// @desc    Remove an account from a user
// @access  Private/Admin
exports.removeAccount = async (req, res) => {
    try {
        const { accountId } = req.params;
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        user.assignedAccounts = user.assignedAccounts.filter(id => id.toString() !== accountId);
        await user.save();
        
        res.json({ msg: 'Account removed', user });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};
