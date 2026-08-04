const CatalogItem = require('../../models/CatalogItem');

/**
 * Service to manage organization-specific catalog items.
 */
class CatalogService {
    /**
     * Create a new catalog item (Product or Service).
     * @param {string} accountId - Organization account ID
     * @param {Object} itemData - { type, fields, status }
     */
    async createItem(accountId, itemData) {
        if (!accountId) throw new Error('accountId is required for organization isolation');
        const newItem = new CatalogItem({
            account: accountId,
            type: itemData.type,
            fields: itemData.fields || {},
            status: itemData.status || 'available'
        });
        return await newItem.save();
    }

    /**
     * Get all catalog items for an organization.
     * @param {string} accountId 
     * @param {Object} [filter={}] - Optional filters like { type, status }
     */
    async getItems(accountId, filter = {}) {
        if (!accountId) throw new Error('accountId is required');
        const query = { account: accountId, ...filter };
        return await CatalogItem.find(query).sort({ createdAt: -1 });
    }

    /**
     * Get a specific catalog item by ID for an organization.
     * @param {string} accountId 
     * @param {string} itemId 
     */
    async getItemById(accountId, itemId) {
        if (!accountId) throw new Error('accountId is required');
        return await CatalogItem.findOne({ _id: itemId, account: accountId });
    }

    /**
     * Update a catalog item.
     * @param {string} accountId 
     * @param {string} itemId 
     * @param {Object} updateData 
     */
    async updateItem(accountId, itemId, updateData) {
        if (!accountId) throw new Error('accountId is required');
        return await CatalogItem.findOneAndUpdate(
            { _id: itemId, account: accountId },
            { $set: updateData },
            { new: true }
        );
    }

    /**
     * Delete a catalog item.
     * @param {string} accountId 
     * @param {string} itemId 
     */
    async deleteItem(accountId, itemId) {
        if (!accountId) throw new Error('accountId is required');
        return await CatalogItem.findOneAndDelete({ _id: itemId, account: accountId });
    }
}

module.exports = new CatalogService();
