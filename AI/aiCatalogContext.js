const catalogService = require('../services/catalog/catalogService');

/**
 * Service to inject dynamic organization catalog context into AI prompts
 * and assist in AI catalog matching / clarification.
 */
class AICatalogContext {
    /**
     * Builds structured catalog text to be appended to the AI System Prompt.
     * Fetches real-time catalog items from MongoDB Atlas.
     * @param {string} accountId - Organization account ID
     * @returns {Promise<string>} Prompt snippet describing available products and services
     */
    async getFormattedCatalogContext(accountId) {
        if (!accountId) return '';

        try {
            const items = await catalogService.getItems(accountId, { status: 'available' });
            if (!items || items.length === 0) {
                return 'AVAILABLE CATALOG: No items currently available in catalog.\n';
            }

            let promptText = 'AVAILABLE CATALOG & SERVICES:\n';
            items.forEach((item, index) => {
                const name = item.fields.name || item.fields.title || `Item ${item._id}`;
                const price = item.fields.price ? ` | Price: ${item.fields.price}` : '';
                const category = item.fields.category ? ` | Category: ${item.fields.category}` : '';
                const details = JSON.stringify(item.fields);

                promptText += `${index + 1}. [${item.type.toUpperCase()}] ID: ${item._id} | Name: "${name}"${price}${category} | Details: ${details}\n`;
            });

            promptText += '\nINSTRUCTIONS FOR CATALOG MATCHING:\n';
            promptText += '- When user mentions wanting a product or service, match their request to the Catalog IDs above.\n';
            promptText += '- If confidence is low or user request matches multiple items (e.g. "I want milk"), ask a clarifying question listing available variants.\n';

            return promptText;
        } catch (err) {
            console.error('[AICatalogContext] Failed to format catalog prompt context:', err);
            return '';
        }
    }

    /**
     * Helper to compute fuzzy catalog match / detect ambiguity.
     * @param {Array} catalogItems 
     * @param {string} query 
     * @returns {Object} { matches: [], isAmbiguous: boolean }
     */
    findCatalogMatches(catalogItems = [], query = '') {
        if (!query || !catalogItems.length) return { matches: [], isAmbiguous: false };

        const lowerQuery = query.toLowerCase();
        const matches = catalogItems.filter(item => {
            const name = (item.fields?.name || item.fields?.title || '').toLowerCase();
            const category = (item.fields?.category || '').toLowerCase();
            return name.includes(lowerQuery) || lowerQuery.includes(name) || category.includes(lowerQuery);
        });

        return {
            matches,
            isAmbiguous: matches.length > 1
        };
    }
}

module.exports = new AICatalogContext();
