const Account = require('../models/Account');
const whatsappBot = require('../bot/whatsapp');

// @route   POST /api/external/send-message
// @desc    Send a WhatsApp message externally using User API Key
// @access  Private (API Key Authenticated)
exports.sendExternalMessage = async (req, res) => {
    try {
        // Extract inputs (flexibility for different payload key naming)
        const receiver = req.body.receiverNumber || req.body.receiver || req.body.to || req.body.phone || req.query.receiverNumber || req.query.to;
        const message = req.body.message || req.body.text || req.body.body || req.query.message;
        const requestedAccountId = req.body.accountId || req.body.sessionId || req.query.accountId || req.header('x-account-id');

        // Validation
        if (!receiver) {
            return res.status(400).json({
                success: false,
                msg: 'Missing receiver phone number. Please supply "receiverNumber" or "to" in JSON payload or query parameters.'
            });
        }

        if (!message || (typeof message === 'string' && !message.trim())) {
            return res.status(400).json({
                success: false,
                msg: 'Missing message content. Please supply "message" or "text" in JSON payload or query parameters.'
            });
        }

        const userId = req.user._id || req.user.id;
        let targetAccount = null;

        if (requestedAccountId) {
            // Find specific account
            targetAccount = await Account.findOne({
                $or: [{ _id: requestedAccountId }, { sessionId: requestedAccountId }]
            });

            if (!targetAccount) {
                return res.status(404).json({
                    success: false,
                    msg: `Specified account "${requestedAccountId}" not found.`
                });
            }

            // Verify ownership or assignment
            const isOwner = targetAccount.user.toString() === userId.toString();
            const isAssigned = (req.user.assignedAccounts || []).some(id => id.toString() === targetAccount._id.toString());
            const isAdmin = req.user.role === 'admin';

            if (!isOwner && !isAssigned && !isAdmin) {
                return res.status(403).json({
                    success: false,
                    msg: 'Unauthorized access to specified account ID.'
                });
            }
        } else {
            // Auto-select ready account owned by user or assigned to user
            targetAccount = await Account.findOne({ user: userId, status: 'ready' });

            if (!targetAccount && (req.user.assignedAccounts || []).length > 0) {
                targetAccount = await Account.findOne({
                    _id: { $in: req.user.assignedAccounts },
                    status: 'ready'
                });
            }

            // Fallback: any account for user if none is 'ready'
            if (!targetAccount) {
                const anyAccount = await Account.findOne({
                    $or: [{ user: userId }, { _id: { $in: req.user.assignedAccounts || [] } }]
                });

                if (!anyAccount) {
                    return res.status(400).json({
                        success: false,
                        msg: 'No WhatsApp account associated with this user API key. Please set up an account in the dashboard.'
                    });
                } else {
                    return res.status(400).json({
                        success: false,
                        msg: `WhatsApp account "${anyAccount.organizationName}" is currently ${anyAccount.status}. Must be active/ready to send messages.`
                    });
                }
            }
        }

        if (targetAccount.status !== 'ready') {
            return res.status(400).json({
                success: false,
                msg: `Account "${targetAccount.organizationName}" is in "${targetAccount.status}" status. It must be connected and ready to send messages.`
            });
        }

        // Send message using whatsappBot manager
        const result = await whatsappBot.sendExternalMessage(targetAccount._id, receiver, message);

        return res.json({
            success: true,
            msg: 'Message sent successfully',
            data: {
                messageId: result.id,
                accountId: targetAccount._id,
                organizationName: targetAccount.organizationName,
                senderPhoneNumber: targetAccount.phoneNumber || null,
                receiver: result.to,
                message: result.content,
                timestamp: result.timestamp
            }
        });

    } catch (err) {
        console.error('External API Send Message Error:', err.message);
        return res.status(500).json({
            success: false,
            msg: 'Failed to send WhatsApp message',
            error: err.message
        });
    }
};
