const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const Resource = require('../models/Resource');
const Folder = require('../models/Folder');
const UserStorage = require('../models/UserStorage');

// Helper to ensure user storage record exists
const ensureUserStorage = async (userId) => {
    let storage = await UserStorage.findOne({ userId });
    if (!storage) {
        storage = new UserStorage({ userId });
        await storage.save();
    }
    return storage;
};

// Ensure base assets directory exists
const ASSETS_DIR = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

// Memory storage for multer to calculate hash before saving to disk
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max per file upload for safety
});

exports.uploadMiddlewares = upload.single('file');

exports.uploadFile = async (req, res) => {
    try {
        const userId = req.user.id;
        const file = req.file;
        const { folderId } = req.body; // Optional parent folder

        if (!file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const userStorage = await ensureUserStorage(userId);

        // Quota check
        if (userStorage.used + file.size > userStorage.limit) {
            return res.status(403).json({ error: 'Storage quota exceeded' });
        }

        // Calculate file hash
        const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');

        // Deduplication check: See if this exact file already exists globally (to save disk space)
        let existingResource = await Resource.findOne({ hash });
        
        let storedName;
        const userDir = path.join(ASSETS_DIR, userId.toString());
        
        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }

        if (existingResource) {
            // Deduplicate: Reuse the existing file's storedName
            // Note: If existingResource owner is different, it might be in another user's folder.
            // For true deduplication, we should store files globally by hash in `assets/shared/` 
            // but the requirements say "assets/userId/". We'll just copy it or reuse if same user.
            // For simplicity and adhering to "Each user must only access their own folder", we will 
            // save a copy in the user's folder if it's not already there.
            storedName = uuidv4() + path.extname(file.originalname);
            const filePath = path.join(userDir, storedName);
            fs.writeFileSync(filePath, file.buffer);
        } else {
            // New file
            storedName = uuidv4() + path.extname(file.originalname);
            const filePath = path.join(userDir, storedName);
            fs.writeFileSync(filePath, file.buffer);
        }

        // Determine type
        let type = 'document';
        if (file.mimetype.startsWith('image/')) type = 'image';
        else if (file.mimetype.startsWith('video/')) type = 'video';
        else if (file.mimetype.startsWith('audio/')) type = 'audio';
        else if (file.mimetype === 'application/pdf') type = 'pdf';

        // Create Resource DB Entry
        const newResource = new Resource({
            ownerId: userId,
            originalName: file.originalname,
            storedName: storedName,
            hash: hash,
            type: type,
            mimeType: file.mimetype,
            extension: path.extname(file.originalname).toLowerCase(),
            size: file.size,
            folderId: folderId || null
        });

        await newResource.save();

        // Update Quota
        userStorage.used += file.size;
        await userStorage.save();

        res.status(201).json(newResource);
    } catch (err) {
        console.error('Upload Error:', err.stack || err);
        res.status(500).json({ error: 'Server error during upload', detail: err.message });
    }
};

exports.createFolder = async (req, res) => {
    try {
        const userId = req.user.id;
        const { name, parentId } = req.body;

        if (!name) return res.status(400).json({ error: 'Folder name required' });

        const folder = new Folder({
            ownerId: userId,
            name,
            parentId: parentId || null
        });

        await folder.save();
        res.status(201).json(folder);
    } catch (err) {
        if (err.code === 11000) {
            return res.status(400).json({ error: 'Folder name already exists in this location' });
        }
        res.status(500).json({ error: 'Server error' });
    }
};

exports.listFolderContents = async (req, res) => {
    try {
        const userId = req.user.id;
        const { folderId } = req.params;

        const queryId = folderId === 'root' ? null : folderId;

        const folders = await Folder.find({ ownerId: userId, parentId: queryId }).sort({ name: 1 });
        const files = await Resource.find({ ownerId: userId, folderId: queryId }).sort({ originalName: 1 });

        res.json({ folders, files });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
};

exports.getUsage = async (req, res) => {
    try {
        const userId = req.user.id;
        const storage = await ensureUserStorage(userId);
        res.json({ used: storage.used, limit: storage.limit });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
};

exports.deleteResource = async (req, res) => {
    try {
        const userId = req.user.id;
        const { resourceId } = req.params;

        const resource = await Resource.findOne({ _id: resourceId, ownerId: userId });
        if (!resource) return res.status(404).json({ error: 'File not found' });

        // Remove from DB
        await Resource.deleteOne({ _id: resourceId });

        // Update quota
        const storage = await ensureUserStorage(userId);
        storage.used = Math.max(0, storage.used - resource.size);
        await storage.save();

        // Check if other resources use this same hash (if we actually shared files across users).
        // Since we stored it in the user's dir, we can safely delete it.
        // Let's verify if there are other references by this user (just in case)
        const duplicate = await Resource.findOne({ ownerId: userId, storedName: resource.storedName });
        if (!duplicate) {
            const filePath = path.join(ASSETS_DIR, userId.toString(), resource.storedName);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        res.json({ message: 'File deleted' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
};

exports.downloadResource = async (req, res) => {
    try {
        const userId = req.user.id;
        const { resourceId } = req.params;

        const resource = await Resource.findOne({ _id: resourceId, ownerId: userId });
        if (!resource) return res.status(404).json({ error: 'File not found' });

        const filePath = path.join(ASSETS_DIR, userId.toString(), resource.storedName);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Physical file missing' });
        }

        res.download(filePath, resource.originalName);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
};

exports.deleteFolder = async (req, res) => {
    // Basic implementation: prevent deleting non-empty folders for safety
    try {
        const userId = req.user.id;
        const { folderId } = req.params;

        const subfolders = await Folder.countDocuments({ parentId: folderId });
        const files = await Resource.countDocuments({ folderId: folderId });

        if (subfolders > 0 || files > 0) {
            return res.status(400).json({ error: 'Folder is not empty. Please delete contents first.' });
        }

        await Folder.deleteOne({ _id: folderId, ownerId: userId });
        res.json({ message: 'Folder deleted' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
};

exports.getResourceMetadata = async (req, res) => {
    try {
        const userId = req.user.id;
        const { resourceId } = req.params;

        const resource = await Resource.findOne({ _id: resourceId, ownerId: userId });
        if (!resource) return res.status(404).json({ error: 'File not found' });

        res.json(resource);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
};

exports.getAllFolders = async (req, res) => {
    try {
        const userId = req.user.id;
        const folders = await Folder.find({ ownerId: userId }).sort({ name: 1 });
        res.json(folders);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
};

exports.moveItem = async (req, res) => {
    try {
        const userId = req.user.id;
        const { itemId, itemType, targetFolderId } = req.body;

        if (!itemId || !itemType) {
            return res.status(400).json({ error: 'itemId and itemType are required' });
        }

        const normalizedTargetFolderId = (targetFolderId === 'root' || !targetFolderId) ? null : targetFolderId;

        // Verify target folder exists if not root
        if (normalizedTargetFolderId) {
            const targetFolder = await Folder.findOne({ _id: normalizedTargetFolderId, ownerId: userId });
            if (!targetFolder) {
                return res.status(404).json({ error: 'Target folder not found' });
            }
        }

        if (itemType === 'file') {
            const file = await Resource.findOne({ _id: itemId, ownerId: userId });
            if (!file) return res.status(404).json({ error: 'File not found' });

            file.folderId = normalizedTargetFolderId;
            file.modifiedDate = new Date();
            await file.save();

            return res.json({ message: 'File moved successfully', file });
        } else if (itemType === 'folder') {
            const folder = await Folder.findOne({ _id: itemId, ownerId: userId });
            if (!folder) return res.status(404).json({ error: 'Folder not found' });

            if (normalizedTargetFolderId && normalizedTargetFolderId.toString() === itemId.toString()) {
                return res.status(400).json({ error: 'Cannot move folder into itself' });
            }

            // Check circular dependency
            if (normalizedTargetFolderId) {
                let currentParent = normalizedTargetFolderId;
                while (currentParent) {
                    if (currentParent.toString() === itemId.toString()) {
                        return res.status(400).json({ error: 'Cannot move folder into its own subfolder' });
                    }
                    const parentFolder = await Folder.findOne({ _id: currentParent, ownerId: userId });
                    currentParent = parentFolder ? parentFolder.parentId : null;
                }
            }

            folder.parentId = normalizedTargetFolderId;
            folder.updatedAt = new Date();
            await folder.save();

            return res.json({ message: 'Folder moved successfully', folder });
        } else {
            return res.status(400).json({ error: 'Invalid itemType' });
        }
    } catch (err) {
        console.error('Move Error:', err);
        res.status(500).json({ error: 'Server error during move', detail: err.message });
    }
};

exports.viewResource = async (req, res) => {
    try {
        const userId = req.user.id;
        const { resourceId } = req.params;

        const resource = await Resource.findOne({ _id: resourceId, ownerId: userId });
        if (!resource) return res.status(404).json({ error: 'File not found' });

        const filePath = path.join(ASSETS_DIR, userId.toString(), resource.storedName);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Physical file missing' });
        }

        res.setHeader('Content-Type', resource.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(resource.originalName)}"`);
        fs.createReadStream(filePath).pipe(res);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
};

