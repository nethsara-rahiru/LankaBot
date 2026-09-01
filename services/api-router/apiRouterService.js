/**
 * apiRouterService.js
 * Primary AI service for FrontDesk.
 * Routes all AI requests through API Router (primary) with Groq as fallback.
 * Preserves the same signature as the legacy getGroqResponse() for compatibility.
 */

const { sendRequest } = require('./apiRouterClient');
const routerConfig = require('./routerConfig');
const { getPromptTemplate, buildExtractionPrompt } = require('../../utils/groq');

/**
 * Builds the final system prompt string.
 * Supports both plain string and object (template variable map) system prompts.
 *
 * @param {string|object} systemPrompt
 * @returns {string}
 */
const resolveSystemPrompt = (systemPrompt) => {
    const defaultPrompt = 'You are FrontDesk, a professional AI assistant.';

    if (systemPrompt && typeof systemPrompt === 'object') {
        let template = getPromptTemplate();
        for (const [key, value] of Object.entries(systemPrompt)) {
            const regex = new RegExp(`{{${key}}}`, 'g');
            template = template.replace(regex, value || 'None');
        }
        // Clean up any unreplaced placeholders
        template = template.replace(/{{.*?}}/g, 'None');
        return template || defaultPrompt;
    }

    if (typeof systemPrompt === 'string') {
        return systemPrompt || defaultPrompt;
    }

    return defaultPrompt;
};

/**
 * Main AI response function.
 * Drop-in replacement for getGroqResponse() used across FrontDesk.
 *
 * @param {string}        prompt       - The user's message / input
 * @param {string|object} systemPrompt - System prompt string or template variable map
 * @param {number}        retries      - Max retries per provider (default 3)
 * @param {number}        maxTokens    - Max tokens for response (default 1024)
 * @returns {Promise<string|null>}     - AI response text, or null on total failure
 */
const getAIResponse = async (prompt, systemPrompt, retries = 3, maxTokens = 1024) => {
    const finalSystemPrompt = resolveSystemPrompt(systemPrompt);

    const messages = [
        { role: 'system', content: finalSystemPrompt },
        { role: 'user', content: prompt }
    ];

    // --- Primary: API Router ---
    console.log(`\n------------------- 📤 AI REQUEST PROMPT -------------------`);
    console.log(`Provider: ${routerConfig.primary.name} (${routerConfig.primary.model})`);
    console.log(`System Prompt:\n${finalSystemPrompt}`);
    console.log(`User Input: "${prompt}"`);
    console.log(`-------------------------------------------------------------\n`);

    const primaryResult = await sendRequest(routerConfig.primary, messages, retries, maxTokens);

    if (primaryResult) {
        console.log('[APIRouterService] ✅ Response received from API Router.');
        return primaryResult;
    }

    // --- Fallback: Groq ---
    console.warn('[APIRouterService] ⚠️ API Router failed or returned empty. Falling back to Groq...');
    const fallbackResult = await sendRequest(routerConfig.fallback, messages, retries, maxTokens);

    if (fallbackResult) {
        console.log('[APIRouterService] ✅ Fallback response received from Groq.');
        return fallbackResult;
    }

    console.error('[APIRouterService] ❌ Both API Router and Groq failed to return a response.');
    return null;
};

module.exports = { getAIResponse, buildExtractionPrompt };
