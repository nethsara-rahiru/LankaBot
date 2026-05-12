const express = require('express');
const router = express.Router();
const ruleController = require('../controllers/ruleController');
const auth = require('../middleware/auth');

// Get all rules for specific account
router.get('/', auth, ruleController.getRules);

// Create a rule for specific account
router.post('/', auth, ruleController.createRule);

// Update a rule
router.patch('/:id', auth, ruleController.updateRule);

// Delete a rule
router.delete('/:id', auth, ruleController.deleteRule);

module.exports = router;
