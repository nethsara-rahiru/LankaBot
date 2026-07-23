const express = require('express');
const router = express.Router();
const accountController = require('../controllers/accountController');
const auth = require('../middleware/auth');

// @route   GET api/accounts
router.get('/', auth, accountController.getAccounts);

// @route   POST api/accounts
router.post('/', auth, accountController.createAccount);

// @route   DELETE api/accounts/:id
router.delete('/:id', auth, accountController.deleteAccount);

// @route   PATCH api/accounts/:id/pause
router.patch('/:id/pause', auth, accountController.togglePause);

// @route   POST api/accounts/:id/reconnect
router.post('/:id/reconnect', auth, accountController.reconnectAccount);

// @route   POST api/accounts/:id/pair
router.post('/:id/pair', auth, accountController.requestPairingCode);

module.exports = router;
