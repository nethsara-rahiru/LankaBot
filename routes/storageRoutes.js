const express = require('express');
const router = express.Router();
const storageController = require('../controllers/storageController');

// Since the platform uses `req.user.id` from authentication middleware,
// we should import it. Assuming it exists in '../middleware/auth'
// based on standard express conventions in this project.
const auth = require('../middleware/auth');

// Folder operations
router.post('/folder', auth, storageController.createFolder);
router.delete('/folder/:folderId', auth, storageController.deleteFolder);

// File operations
router.post('/upload', auth, storageController.uploadMiddlewares, storageController.uploadFile);
router.delete('/file/:resourceId', auth, storageController.deleteResource);
router.get('/download/:resourceId', auth, storageController.downloadResource);
router.get('/metadata/:resourceId', auth, storageController.getResourceMetadata);

// List contents (root or specific folder)
router.get('/list/:folderId', auth, storageController.listFolderContents);

// Storage usage
router.get('/usage', auth, storageController.getUsage);

module.exports = router;
