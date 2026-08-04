const catalogService = require('../services/catalog/catalogService');

class CatalogController {
    async getItems(req, res) {
        try {
            const accountId = req.header('x-account-id');
            if (!accountId) return res.status(400).json({ msg: 'x-account-id header required' });
            
            const filter = {};
            if (req.query.type) filter.type = req.query.type;
            if (req.query.status) filter.status = req.query.status;

            const items = await catalogService.getItems(accountId, filter);
            res.json(items);
        } catch (err) {
            console.error('Error fetching catalog items:', err);
            res.status(500).json({ msg: 'Server error', error: err.message });
        }
    }

    async getItemById(req, res) {
        try {
            const accountId = req.header('x-account-id');
            if (!accountId) return res.status(400).json({ msg: 'x-account-id header required' });

            const item = await catalogService.getItemById(accountId, req.params.id);
            if (!item) return res.status(404).json({ msg: 'Item not found' });

            res.json(item);
        } catch (err) {
            console.error('Error fetching item:', err);
            res.status(500).json({ msg: 'Server error', error: err.message });
        }
    }

    async createItem(req, res) {
        try {
            const accountId = req.header('x-account-id');
            if (!accountId) return res.status(400).json({ msg: 'x-account-id header required' });

            const { type, fields, status } = req.body;
            if (!type || !fields || !fields.name) {
                return res.status(400).json({ msg: 'Type and fields.name are required' });
            }

            const item = await catalogService.createItem(accountId, { type, fields, status });
            res.status(201).json(item);
        } catch (err) {
            console.error('Error creating item:', err);
            res.status(500).json({ msg: 'Server error', error: err.message });
        }
    }

    async updateItem(req, res) {
        try {
            const accountId = req.header('x-account-id');
            if (!accountId) return res.status(400).json({ msg: 'x-account-id header required' });

            const item = await catalogService.updateItem(accountId, req.params.id, req.body);
            if (!item) return res.status(404).json({ msg: 'Item not found' });

            res.json(item);
        } catch (err) {
            console.error('Error updating item:', err);
            res.status(500).json({ msg: 'Server error', error: err.message });
        }
    }

    async deleteItem(req, res) {
        try {
            const accountId = req.header('x-account-id');
            if (!accountId) return res.status(400).json({ msg: 'x-account-id header required' });

            const item = await catalogService.deleteItem(accountId, req.params.id);
            if (!item) return res.status(404).json({ msg: 'Item not found' });

            res.json({ msg: 'Item deleted successfully' });
        } catch (err) {
            console.error('Error deleting item:', err);
            res.status(500).json({ msg: 'Server error', error: err.message });
        }
    }
}

module.exports = new CatalogController();
