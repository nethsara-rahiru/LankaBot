const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const auth = require('../middleware/auth');

// Get settings for specific account
router.get('/', auth, settingsController.getSettings);

// Update settings for specific account
router.patch('/', auth, settingsController.updateSettings);

module.exports = router;
