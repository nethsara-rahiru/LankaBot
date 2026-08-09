/**
 * understandingService.js  — Stage 1 AI
 *
 * Sends the user's message + full context to the AI and receives a structured
 * "understanding" result. This is NOT responsible for generating the final
 * customer-facing response — it only parses what the user said.
 *
 * Output schema:
 * {
 *   intent: "PROVIDE_DATA" | "ASK_QUESTION" | "MULTI_INTENT" | "CHANGE_DATA" |
 *           "CONFIRM" | "REJECT" | "CHANGE_TOPIC" | "GENERAL_CONVERSATION" | ...
 *   extractedData: { variableName: value, ... }
 *   questions: [ "question text", ... ]
 *   corrections: [ { variable, oldValue, newValue }, ... ]
 *   topicChange: "topicId" | null
 *   confidence: "high" | "medium" | "low"
 *   continueFlow: true | false
 * }
 */

const { getAIResponse } = require('../api-router/apiRouterService');
const { formatConversationHistory, formatVariables } = require('./contextService');

/**
 * Builds the Stage 1 understanding system prompt.
 *
 * @param {object} ctx - Built context from contextService.buildContext()
 * @returns {string}
 */
const buildUnderstandingPrompt = (ctx) => {
    const nodeDesc = ctx.currentNode
        ? `Current flow node type: ${ctx.currentNode.type}
Current required variable: ${ctx.currentNode.variable || 'none'}
Current prompt shown to user: ${ctx.currentNode.prompt || 'none'}`
        : 'No active flow node.';

    const topicList = ctx.availableTopics.length > 0
        ? ctx.availableTopics.map(t => `- ${t.id}: ${t.description || 'No description'}`).join('\n')
        : 'None.';

    const businessDesc = ctx.business.name
        ? `Business: ${ctx.business.name}${ctx.business.description ? `\nDescription: ${ctx.business.description}` : ''}`
        : '';

    return `You are a conversation understanding AI for ${ctx.business.name || 'FrontDesk'}, a WhatsApp business bot.

Your ONLY job is to analyse the user's message and return a structured JSON understanding.
Do NOT generate a customer-facing reply. Return ONLY valid JSON.

=== BUSINESS CONTEXT ===
${businessDesc}
${ctx.business.openingHours ? `Opening Hours: ${ctx.business.openingHours}` : ''}
${ctx.business.deliveryInfo ? `Delivery Info: ${ctx.business.deliveryInfo}` : ''}
${ctx.business.extraInfo ? `Additional Info: ${ctx.business.extraInfo}` : ''}

=== CURRENT TOPIC ===
ID: ${ctx.currentTopic.id || 'none'}
Description: ${ctx.currentTopic.description || 'none'}

=== CURRENT FLOW NODE ===
${nodeDesc}

=== COLLECTED VARIABLES SO FAR ===
${formatVariables(ctx.variables)}

=== RECENT CONVERSATION ===
${formatConversationHistory(ctx.conversation)}

=== AVAILABLE TOPICS ===
${topicList}

=== USER MESSAGE ===
"${ctx.userInput}"

=== YOUR TASK ===
Analyse the user's message holistically. Do NOT only look for the currently required variable.

Extract ALL useful information the user has shared — even if the flow only needs one thing right now.

Detect:
1. Data the user is providing (may include multiple fields)
2. Questions the user is asking (even if unrelated to the flow)
3. Corrections to previously collected data
4. Whether the user is switching topics
5. Whether they are confirming, rejecting, or REFUSING/DECLINING to answer (e.g. "no", "I don't want to tell you", "skip", "pass", "mind your business", "never mind", "no thanks", "I decline")
6. Multiple intents in the same message

IMPORTANT RULES:
- If the user explicitly refuses, declines, says "skip", "no", "pass", "never mind", "I don't want to share/tell", or indicates they do not want to answer the requested question, set "intent": "REFUSE", "userRefused": true, and "continueFlow": false.
- If the user provides a value for a variable that is already collected, treat it as a CORRECTION (not a new entry).
- If the user asks a question, include it in "questions". Do NOT ignore it.
- Only set "topicChange" if the user is clearly and intentionally switching to a different topic — not for temporary questions.
- For uncertain values, set confidence to "low" and do NOT include the data in extractedData.
- "continueFlow" should be true unless the user is cancelling, refusing to answer, or switching topics.

Return ONLY this JSON:
{
  "intent": "PROVIDE_DATA | ASK_QUESTION | MULTI_INTENT | CHANGE_DATA | CONFIRM | REJECT | REFUSE | CHANGE_TOPIC | CANCEL | GENERAL_CONVERSATION",
  "userRefused": false,
  "extractedData": {},
  "questions": [],
  "corrections": [],
  "topicChange": null,
  "confidence": "high | medium | low",
  "continueFlow": true
}`;
};

/**
 * Parses and validates the raw AI JSON response for Stage 1 understanding.
 *
 * @param {string} raw - Raw AI output string
 * @returns {object|null} - Parsed understanding object, or null on failure
 */
const parseUnderstandingResponse = (raw) => {
    if (!raw) return null;
    try {
        const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
    } catch (e) {
        console.error('[UnderstandingService] ❌ Failed to parse AI understanding response:', e.message);
    }
    return null;
};

/**
 * Stage 1: Understand what the user said.
 *
 * Sends user message + context to AI and returns structured understanding result.
 * Falls back to a simple extraction-only result on failure.
 *
 * @param {object} ctx - Built context from contextService.buildContext()
 * @returns {Promise<object>} - Structured understanding result
 */
const understandMessage = async (ctx) => {
    const systemPrompt = buildUnderstandingPrompt(ctx);

    console.log(`[UnderstandingService] 🧠 Stage 1: Understanding message for topic "${ctx.currentTopic.id || 'unknown'}" | Node: "${ctx.currentNode?.id || 'none'}"`);

    let raw = null;
    try {
        raw = await getAIResponse(ctx.userInput, systemPrompt, 2);
        console.log(`[UnderstandingService] 📥 Raw Stage 1 response: ${raw ? raw.substring(0, 200) : 'null'}`);
    } catch (e) {
        console.error('[UnderstandingService] ❌ AI call failed:', e.message);
    }

    const parsed = parseUnderstandingResponse(raw);

    if (parsed) {
        console.log(`[UnderstandingService] ✅ Understanding: intent="${parsed.intent}", extractedData=${JSON.stringify(parsed.extractedData)}, questions=${JSON.stringify(parsed.questions)}, topicChange=${parsed.topicChange}, confidence=${parsed.confidence}`);
        return parsed;
    }

    // Fallback: return a minimal result so the flow doesn't break
    console.warn('[UnderstandingService] ⚠️ Falling back to empty understanding result.');
    return {
        intent: 'GENERAL_CONVERSATION',
        extractedData: {},
        questions: [],
        corrections: [],
        topicChange: null,
        confidence: 'low',
        continueFlow: true
    };
};

module.exports = { understandMessage };
