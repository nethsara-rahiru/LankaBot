/**
 * responseService.js  — Stage 2 AI
 *
 * Generates the final natural-language response to send to the user.
 * It consumes the Stage 1 understanding result plus updated flow state
 * to produce a single, coherent message that:
 *   - Acknowledges data provided
 *   - Answers any user questions using business context
 *   - Naturally asks for the next missing piece of information
 *
 * This service does NOT modify flow state. It only generates text.
 */

const { getAIResponse } = require('../api-router/apiRouterService');
const { formatConversationHistory, formatVariables } = require('./contextService');

/**
 * Builds the Stage 2 response generation system prompt.
 *
 * @param {object} ctx            - Context from contextService.buildContext()
 * @param {object} understanding  - Result from understandingService.understandMessage()
 * @param {string|null} nextRequired - The next variable name still needed, or null
 * @returns {string}
 */
const buildResponsePrompt = (ctx, understanding, nextRequired) => {
    const extractedSummary = Object.entries(understanding.extractedData || {})
        .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
        .join('\n') || '  Nothing new extracted.';

    const correctionsSummary = (understanding.corrections || []).length > 0
        ? understanding.corrections.map(c => `  ${c.variable}: "${c.oldValue}" → "${c.newValue}"`).join('\n')
        : '  None.';

    const questionsList = (understanding.questions || []).length > 0
        ? understanding.questions.map(q => `  - ${q}`).join('\n')
        : '  None.';

    const isRefusal = understanding.intent === 'REFUSE' || understanding.userRefused === true;

    const nextRequiredDesc = isRefusal
        ? `The user REFUSED or DECLINED to provide the requested information. Do NOT ask for the missing information again! Politely acknowledge their choice (e.g. "No problem at all!"). If they asked any questions, answer them. Then naturally ask: "Is there anything else I can help you with?"`
        : nextRequired
            ? `The flow still needs: "${nextRequired}". Ask for it naturally — but ONLY if you have not already addressed all the user's questions. Do not repeat a question the user just answered.`
            : 'All required information has been collected. Do not ask for anything more.';

    const businessInfo = [
        ctx.business.name ? `Business: ${ctx.business.name}` : null,
        ctx.business.description ? `Description: ${ctx.business.description}` : null,
        ctx.business.openingHours ? `Opening Hours: ${ctx.business.openingHours}` : null,
        ctx.business.deliveryInfo ? `Delivery Info: ${ctx.business.deliveryInfo}` : null,
        ctx.business.policies ? `Policies: ${ctx.business.policies}` : null,
        ctx.business.contactDetails ? `Contact: ${ctx.business.contactDetails}` : null,
        ctx.business.extraInfo ? `Extra: ${ctx.business.extraInfo}` : null
    ].filter(Boolean).join('\n');

    return `You are a friendly, professional business assistant for ${ctx.business.name || 'this business'}.

Your job is to write ONE natural response to send to the customer on WhatsApp.

The response must:
1. Acknowledge any data the customer just provided (briefly and warmly).
2. Answer any questions the customer asked using the business information below.
3. If the user sent a greeting (e.g. "hi", "hello", "good morning"), warmly welcome them back and introduce the fresh conversation flow from the beginning.
4. If the user declined or refused to give information, respect their choice warmly and ask "Is there anything else I can help you with?". Do NOT force or re-ask the question.
5. If not refused or greeting restart, ask for the next missing piece of information (if any), naturally and conversationally.
6. NEVER be robotic or list-like. Sound human.
7. Be concise — WhatsApp messages should be brief and clear.
8. Do NOT say you are an AI.

=== BUSINESS INFORMATION ===
${businessInfo || 'Not provided.'}

=== CURRENT TOPIC ===
${ctx.currentTopic.description || ctx.currentTopic.id || 'General conversation'}

=== COLLECTED DATA SO FAR ===
${formatVariables(ctx.variables)}

=== WHAT THE USER PROVIDED THIS TURN ===
${extractedSummary}

=== CORRECTIONS THIS TURN ===
${correctionsSummary}

=== QUESTIONS THE USER ASKED ===
${questionsList}

=== RECENT CONVERSATION ===
${formatConversationHistory(ctx.conversation)}

=== USER MESSAGE ===
"${ctx.userInput}"

=== WHAT TO DO NEXT ===
${nextRequiredDesc}

Write the response now. Output ONLY the message text — no JSON, no labels, no formatting prefixes.`;
};

/**
 * Stage 2: Generate the natural customer-facing response.
 *
 * @param {object} ctx           - Context from contextService.buildContext()
 * @param {object} understanding - Result from understandingService.understandMessage()
 * @param {string|null} nextRequired - Variable name still needed, or null
 * @returns {Promise<string>}    - Final response text to send to user
 */
const generateResponse = async (ctx, understanding, nextRequired) => {
    const systemPrompt = buildResponsePrompt(ctx, understanding, nextRequired);

    console.log(`[ResponseService] 💬 Stage 2: Generating response | Questions: ${(understanding.questions || []).length} | Next required: ${nextRequired || 'none'}`);

    let response = null;
    try {
        response = await getAIResponse(ctx.userInput, systemPrompt, 2);
        console.log(`[ResponseService] ✅ Generated response: "${response ? response.substring(0, 100) : 'null'}"`);
    } catch (e) {
        console.error('[ResponseService] ❌ Response generation failed:', e.message);
    }

    if (response && response.trim()) {
        return response.trim();
    }

    // Fallback: ask for the missing variable directly
    if (nextRequired) {
        return `Could you please provide your ${nextRequired}?`;
    }

    return 'Thank you! How can I help you further?';
};

module.exports = { generateResponse };
