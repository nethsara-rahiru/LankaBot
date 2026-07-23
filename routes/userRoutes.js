const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');

// @route   GET api/users
router.get('/', userController.getUsers);

// @route   POST api/users/register
router.post('/register', userController.registerUser);

// @route   POST api/users/login
router.post('/login', userController.loginUser);

// --- Admin Routes ---
router.get('/admin', auth, admin, userController.getAllUsersAdmin);
router.put('/admin/:id/role', auth, admin, userController.updateUserRole);
router.put('/admin/:id/status', auth, admin, userController.updateUserStatus);
router.delete('/admin/:id', auth, admin, userController.deleteUser);
router.post('/admin/:id/accounts', auth, admin, userController.assignAccount);
router.delete('/admin/:id/accounts/:accountId', auth, admin, userController.removeAccount);

module.exports = router;
