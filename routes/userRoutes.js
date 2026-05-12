const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

// @route   GET api/users
router.get('/', userController.getUsers);

// @route   POST api/users/register
router.post('/register', userController.registerUser);

// @route   POST api/users/login
router.post('/login', userController.loginUser);

module.exports = router;
