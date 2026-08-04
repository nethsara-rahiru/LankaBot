const catalogService = require('../catalog/catalogService');
const orderService = require('../orders/orderService');

/**
 * Handlers for Flow Manager blocks:
 * 1. Catalog Selector Block
 * 2. Array Manager Block
 * 3. Place Order Block
 */

/**
 * Process Catalog Selector Block in a flow execution context.
 * Filters available catalog items for selection in the conversation.
 * @param {string} accountId - Organization account ID
 * @param {Object} blockConfig - { itemType: 'product'|'service', filterStatus: 'available' }
 * @returns {Promise<Array>} List of catalog items formatted for flow variable storage
 */
async function executeCatalogSelectorBlock(accountId, blockConfig = {}) {
    const filter = {};
    if (blockConfig.itemType) filter.type = blockConfig.itemType;
    if (blockConfig.filterStatus) filter.status = blockConfig.filterStatus;

    const catalogItems = await catalogService.getItems(accountId, filter);
    
    return catalogItems.map(item => ({
        itemId: item._id.toString(),
        type: item.type,
        status: item.status,
        ...item.fields
    }));
}

/**
 * Process Array Manager Block in a flow execution context.
 * Performs array operations (push, edit, delete, clear) on cart items.
 * @param {Array} arrayVariable - Current state array (e.g. flowState.cart)
 * @param {Object} operation - { action: 'push'|'edit'|'delete'|'clear', item, index }
 * @returns {Array} Updated array variable
 */
function executeArrayManagerBlock(arrayVariable = [], operation = {}) {
    const list = Array.isArray(arrayVariable) ? [...arrayVariable] : [];
    const { action, item, index } = operation;

    switch (action) {
        case 'push':
        case 'add':
            if (item) list.push(item);
            break;
        case 'edit':
        case 'update':
            if (index !== undefined && index >= 0 && index < list.length) {
                list[index] = { ...list[index], ...item };
            }
            break;
        case 'delete':
        case 'remove':
            if (index !== undefined && index >= 0 && index < list.length) {
                list.splice(index, 1);
            }
            break;
        case 'clear':
            return [];
        default:
            break;
    }
    return list;
}

/**
 * Process Place Order Block in a flow execution context.
 * Converts flow cart items into a structured DB Order with historical item snapshots.
 * @param {string} accountId - Organization account ID
 * @param {Object} flowState - { cart: [], customerId, organizationContactId, customFields }
 * @returns {Promise<Object>} Created Order document
 */
async function executePlaceOrderBlock(accountId, flowState = {}) {
    const items = (flowState.cart || flowState.items || []).map(cartItem => ({
        itemId: cartItem.itemId || cartItem.id || null,
        quantity: cartItem.quantity || 1,
        customSnapshot: cartItem.snapshot || cartItem
    }));

    const orderData = {
        customerId: flowState.customerId || null,
        organizationContactId: flowState.organizationContactId || null,
        items,
        customFields: flowState.customFields || {},
        status: flowState.orderStatus || 'received',
        source: 'flow'
    };

    return await orderService.createOrder(accountId, orderData);
}

module.exports = {
    executeCatalogSelectorBlock,
    executeArrayManagerBlock,
    executePlaceOrderBlock
};
