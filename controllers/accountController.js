const Account = require('../models/Account');
const Settings = require('../models/Settings');
const whatsappBot = require('../bot/whatsapp');

// @route   GET api/accounts
// @desc    Get all accounts for the logged in user (owned and assigned)
// @access  Private
exports.getAccounts = async (req, res) => {
    try {
        const User = require('../models/User');
        const user = await User.findById(req.user.id);
        
        const accounts = await Account.find({
            $or: [
                { user: req.user.id },
                { _id: { $in: user ? user.assignedAccounts : [] } }
            ]
        });
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
        const { sessionId, organizationName } = req.body;

        if (!organizationName) {
            return res.status(400).json({ msg: 'Organization Name is required' });
        }

        let account = await Account.findOne({ sessionId });
        if (account) {
            return res.status(400).json({ msg: 'Session ID already exists' });
        }

        account = new Account({
            user: req.user.id,
            sessionId,
            organizationName,
            status: 'disconnected'
        });

        await account.save();

        // Create default settings for this account
        const settings = new Settings({
            account: account._id,
            aiConfig: {
                organizationName: organizationName
            }
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

// @route   POST api/accounts/:id/reconnect
// @desc    Reconnect a WhatsApp session (stop + restart client, preserve all data)
// @access  Private
exports.reconnectAccount = async (req, res) => {
    try {
        const account = await Account.findById(req.params.id);
        if (!account) return res.status(404).json({ msg: 'Account not found' });
        if (account.user.toString() !== req.user.id) return res.status(401).json({ msg: 'Not authorized' });

        // Stop existing client if running
        await whatsappBot.stopClient(account._id);

        // Reset status so a fresh QR is generated
        account.status = 'disconnected';
        account.lastQR = null;
        await account.save();

        // Start the client again — it will emit a new QR via socket
        whatsappBot.startClient(account._id);

        res.json({ msg: 'Reconnecting session...', account });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @route   POST api/accounts/:id/pair
// @desc    Request a pairing code for a remote client's phone number
// @access  Private
exports.requestPairingCode = async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        if (!phoneNumber) return res.status(400).json({ msg: 'Phone number is required' });

        const account = await Account.findById(req.params.id);
        if (!account) return res.status(404).json({ msg: 'Account not found' });
        if (account.user.toString() !== req.user.id) return res.status(401).json({ msg: 'Not authorized' });

        // Stop existing client if running
        await whatsappBot.stopClient(account._id);

        // Reset status
        account.status = 'disconnected';
        account.lastQR = null;
        await account.save();

        // Start client with pairing mode — the phone number is passed to the bot
        whatsappBot.startClientWithPairing(account._id, phoneNumber);

        res.json({ msg: 'Requesting pairing code...', account });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};
