const express = require('express');
const router = express.Router();
const externalController = require('../controllers/externalController');
const apiKeyAuth = require('../middleware/apiKeyAuth');

// @route   POST api/external/send-message
// @desc    Send a WhatsApp message externally using User API Key
// @access  Private (API Key Authenticated)
router.post('/send-message', apiKeyAuth, externalController.sendExternalMessage);

module.exports = router;
