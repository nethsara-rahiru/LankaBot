const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

// @route   GET api/users
router.get('/', userController.getUsers);

// @route   POST api/users
router.post('/', userController.createUser);

module.exports = router;
