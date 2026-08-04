const express = require('express');
const router = express.Router();
const catalogController = require('../controllers/catalogController');
const auth = require('../middleware/auth');

router.get('/', auth, catalogController.getItems);
router.get('/:id', auth, catalogController.getItemById);
router.post('/', auth, catalogController.createItem);
router.put('/:id', auth, catalogController.updateItem);
router.delete('/:id', auth, catalogController.deleteItem);

module.exports = router;
