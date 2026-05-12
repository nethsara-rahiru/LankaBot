const Account = require('../models/Account');
const Settings = require('../models/Settings');
const whatsappBot = require('../bot/whatsapp');

// @route   GET api/accounts
// @desc    Get all accounts for the logged in user
// @access  Private
exports.getAccounts = async (req, res) => {
    try {
        const accounts = await Account.find({ user: req.user.id });
        res.json(accounts);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @route   POST api/accounts
// @desc    Create a new WhatsApp account session
// @access  Private
exports.createAccount = async (req, res) => {
    try {
        const { sessionId } = req.body; // User provided name for the session

        let account = await Account.findOne({ sessionId });
        if (account) {
            return res.status(400).json({ msg: 'Session ID already exists' });
        }

        account = new Account({
            user: req.user.id,
            sessionId,
            status: 'disconnected'
        });

        await account.save();

        // Create default settings for this account
        const settings = new Settings({
            account: account._id
        });
        await settings.save();

        // Initialize the WhatsApp client for this new account
        whatsappBot.startClient(account._id);

        res.json(account);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @route   DELETE api/accounts/:id
// @desc    Delete an account and stop its client
// @access  Private
exports.deleteAccount = async (req, res) => {
    try {
        const account = await Account.findById(req.params.id);

        if (!account) {
            return res.status(404).json({ msg: 'Account not found' });
        }

        // Check user
        if (account.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized' });
        }

        // Stop the client
        await whatsappBot.stopClient(account._id);

        await Account.deleteOne({ _id: account._id });

        res.json({ msg: 'Account removed' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};
// @route   PATCH api/accounts/:id/pause
// @desc    Toggle pause state of an account
// @access  Private
exports.togglePause = async (req, res) => {
    try {
        const account = await Account.findById(req.params.id);
        if (!account) return res.status(404).json({ msg: 'Account not found' });
        if (account.user.toString() !== req.user.id) return res.status(401).json({ msg: 'Not authorized' });

        account.paused = !account.paused;
        await account.save();

        res.json(account);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};
