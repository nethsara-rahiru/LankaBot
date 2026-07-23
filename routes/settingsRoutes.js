const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const auth = require('../middleware/auth');

// Get compiled prompt from AI scripts
router.get('/compiled-prompt', auth, settingsController.getCompiledPrompt);

// Get individual AI script files
router.get('/prompt-scripts', auth, settingsController.getPromptScriptsEndpoint);

// Get settings for specific account
router.get('/', auth, settingsController.getSettings);

// Update settings for specific account
router.patch('/', auth, settingsController.updateSettings);

// Reset flows for account
router.post('/reset-flows', auth, settingsController.resetFlows);

// Custom Prompts
router.get('/custom-prompts', auth, settingsController.getCustomPrompts);
router.post('/custom-prompts', auth, settingsController.addCustomPrompt);
router.delete('/custom-prompts/:promptId', auth, settingsController.deleteCustomPrompt);

module.exports = router;
