/**
 * contextService.js
 *
 * Assembles the AI context payload from all available sources:
 *   - Current FlowRuntime state (topic, node, variables)
 *   - Recent conversation history (nodeHistory)
 *   - Business information (Settings / Account)
 *   - Available flow topics (entrypoints)
 *   - Catalog data (optional, when available)
 *
 * This context is consumed by understandingService (Stage 1) and
 * responseService (Stage 2).
 */

/**
 * Builds the full context object required for AI operations.
 *
 * @param {object} flow         - Active FlowRuntime instance
 * @param {string} userInput    - The raw user message
 * @param {object} [business]   - Business info { name, description, settings }
 * @param {Array}  [catalog]    - Optional array of catalog items
 * @returns {object}            - Full context payload
 */
const buildContext = (flow, userInput, business = {}, catalog = []) => {
    // --- Current topic context ---
    const currentTopic = (flow && typeof flow._getCurrentTopicContext === 'function')
        ? flow._getCurrentTopicContext()
        : { id: null, description: null };

    // --- Current node info ---
    const currentNode = (flow && flow.currentNodeId && flow.compiled)
        ? (flow.compiled.steps || []).find(s => s.id === flow.currentNodeId) || null
        : null;

    const nodeContext = currentNode ? {
        id: currentNode.id,
        type: currentNode.type,
        variable: currentNode.data?.variable || null,
        prompt: currentNode.data?.prompt || null,
        aiPrompt: currentNode.data?.aiPrompt || null,
        description: currentNode.data?.description || currentNode.data?.prompt || null
    } : null;

    // --- Current variables ---
    const variables = (flow && flow.variables) ? { ...flow.variables } : {};

    // --- Conversation history ---
    const conversation = (flow && Array.isArray(flow.nodeHistory)) ? flow.nodeHistory : [];

    // --- Available topics ---
    const entrypoints = (flow && flow.compiled && flow.compiled.entrypoints) ? flow.compiled.entrypoints : {};
    const availableTopics = Object.keys(entrypoints).map(k => ({
        id: k,
        description: entrypoints[k].description || null
    }));

    // --- Business info ---
    const businessContext = {
        name: business.name || business.settings?.aiConfig?.organizationName || 'FrontDesk',
        description: business.description || business.settings?.aiConfig?.aiPersonality || null,
        openingHours: business.settings?.openingHours || null,
        deliveryInfo: business.settings?.deliveryInfo || null,
        policies: business.settings?.policies || null,
        contactDetails: business.settings?.contactDetails || null,
        extraInfo: business.settings?.aiConfig?.extraInstructions || null
    };

    return {
        userInput,
        conversation,
        currentTopic,
        currentNode: nodeContext,
        variables,
        availableTopics,
        business: businessContext,
        catalog: catalog || []
    };
};

/**
 * Formats conversation history as a readable text block.
 *
 * @param {Array} conversation - Array of { role, content } objects
 * @returns {string}
 */
const formatConversationHistory = (conversation) => {
    if (!Array.isArray(conversation) || conversation.length === 0) return 'No previous conversation.';
    return conversation
        .map(m => `${m.role === 'bot' ? 'BOT' : 'USER'}: ${m.content}`)
        .join('\n');
};

/**
 * Formats variables into a readable summary string.
 *
 * @param {object} variables
 * @returns {string}
 */
const formatVariables = (variables) => {
    if (!variables || Object.keys(variables).length === 0) return 'None collected yet.';
    return Object.entries(variables)
        .map(([k, v]) => {
            const val = v === null || v === undefined || v === '' ? '(not provided)' : JSON.stringify(v);
            return `  ${k}: ${val}`;
        })
        .join('\n');
};

module.exports = { buildContext, formatConversationHistory, formatVariables };
