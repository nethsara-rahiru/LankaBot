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
const { translateIncomingToEnglish } = require('../languageService');

// ─── Greeting fast-path ────────────────────────────────────────────────────────
// A comprehensive list of greeting phrases across English, Sinhala, Singlish,
// Tamil, and other common languages. When a message matches one of these (after
// normalisation) the Stage 1 AI call is skipped entirely.
const GREETING_PATTERNS = [
    // English
    /^hi\b/, /^hey\b/, /^hello\b/, /^helo\b/, /^helo\b/,
    /^good\s*(morning|afternoon|evening|night|day)\b/,
    /^howdy\b/, /^greetings\b/, /^sup\b/, /^whats?\s*up\b/,
    /^yo\b/, /^hiya\b/,
    // Sinhala / Singlish transliteration
    /^ayubowan\b/, /^kohomada\b/, /^kohomada?\b/, /^suba\s*dawasak\b/,
    /^suba\s*udaasanak\b/, /^halo\b/, /^haa\b/, /^machan\b/,
    // Tamil / Romanized Tamil
    /^vanakkam\b/, /^vannakam\b/, /^namaste\b/, /^namaskar\b/,
    /^konichiwa\b/,
    // Arabic / Urdu
    /^salam\b/, /^salaam\b/, /^as\s*salamu?\b/,
    // Emoji-only or emoji + greeting
    /^[\u{1F44B}\u{1F44F}\u{1F600}\u{1F601}\u{1F603}\u{1F604}\u{1F970}]+$/u,
];

/**
 * Returns true if the input is clearly just a greeting with no additional data.
 * Checks the normalised input against GREETING_PATTERNS.
 *
 * @param {string} input
 * @returns {boolean}
 */
const isGreeting = (input) => {
    if (!input || typeof input !== 'string') return false;
    const normalised = input.trim().toLowerCase().replace(/[!?.,'\u200b\u200c\u200d]/g, '').trim();
    if (!normalised) return false;
    // Word count guard — a pure greeting is short (≤ 4 words)
    const wordCount = normalised.split(/\s+/).filter(Boolean).length;
    if (wordCount > 4) return false;
    return GREETING_PATTERNS.some(re => re.test(normalised));
};

// ─── Greeting fast-path ────────────────────────────────────────────────────────

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
5. Whether they are confirming, rejecting, or STRICTLY REFUSING/DECLINING to answer requested private/personal information (e.g. "why do you need my name?", "I don't want to share my email", "mind your own business", "I refuse to answer"). Note: Simple negative answers or choices like "no", "na", "ba", "epa", "nope", or option selections are NOT refusals — classify them as REJECT or option choice.
6. Greetings / Salutations (e.g. "hi", "hello", "hey", "good morning", "ayubowan", "vanakkam", "halo", etc.)
7. Multiple intents in the same message

- If the user's message is a reply to a previous message (e.g. "[Replying to message: ...]"), use the quoted message text to resolve ambiguous references like "this product", "tell me more about this", "I want this one", etc., and extract the relevant product name or details.
- If the user explicitly greets (e.g. "hi", "hello", "hey", "good morning", "ayubowan", etc.), set "intent": "GREETING".
- Set "intent": "REFUSE", "userRefused": true, and "continueFlow": false ONLY if the user explicitly and strictly refuses to provide requested private/personal information (e.g. "why do you need my name?", "I don't want to give my number", "mind your own business", "skip this question", "I refuse"). Do NOT set REFUSE for simple negative choices or answers like "no", "na", "ba", "epa", "nope" to options or yes/no questions — classify simple "no" as REJECT instead.
- If the user provides a value for a variable that is already collected, treat it as a CORRECTION (not a new entry).
- If the user asks a question, include it in "questions". Do NOT ignore it.
- Only set "topicChange" if the user is clearly and intentionally switching to a different topic — not for temporary questions.
- For uncertain values, set confidence to "low" and do NOT include the data in extractedData.
- "continueFlow" should be true unless the user is cancelling, strictly refusing to answer, or switching topics.

Return ONLY this JSON:
{
  "intent": "PROVIDE_DATA | ASK_QUESTION | MULTI_INTENT | CHANGE_DATA | CONFIRM | REJECT | REFUSE | GREETING | CHANGE_TOPIC | CANCEL | GENERAL_CONVERSATION",
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
    console.log(`[UnderstandingService] 🧠 Stage 1: Understanding message for topic "${ctx.currentTopic.id || 'unknown'}" | Node: "${ctx.currentNode?.id || 'none'}"`);

    // ── Incoming Translation Pre-Processing ────────────────────────────────────
    // Translate non-English input (Sinhala, Singlish, Tamil, etc.) to English before AI processing.
    // IMPORTANT: If the input has a [Replying to message: "..."] prefix, only translate the actual
    // user reply part — not the structured prefix — then re-assemble so the AI gets correct context.
    let workingInput = ctx.userInput;
    try {
        // Split off any [Replying to message: "..."] prefix from the actual reply text
        const replyPrefixMatch = workingInput.match(/^(\[Replying to message: "[\s\S]*?"\]\s*)([\s\S]*)$/);
        const prefix = replyPrefixMatch ? replyPrefixMatch[1] : '';
        const actualReply = replyPrefixMatch ? replyPrefixMatch[2].trim() : workingInput;

        const { translatedText, wasTranslated } = await translateIncomingToEnglish(actualReply, ctx.customer);
        if (wasTranslated && translatedText) {
            console.log(`[UnderstandingService] 🌐 Pre-translated user reply to English for AI Stage 1: "${actualReply}" → "${translatedText}"`);
            // Reassemble: keep the structured prefix intact, replace only the translated reply
            const reassembled = prefix ? `${prefix}${translatedText}` : translatedText;
            workingInput = reassembled;
            ctx.userInput = reassembled;
        }
    } catch (err) {
        console.error('[UnderstandingService] ⚠️ Translation pre-processing error:', err.message);
    }

    // ── Fast-path 1: Greeting detection (no AI call) ──────────────────────────
    // Check common multi-language greetings locally before hitting the AI.
    // For reply messages, extract only the actual reply part for greeting detection.
    const greetingCheckInput = workingInput.replace(/^\[Replying to message: "[\s\S]*?"\]\s*/, '').trim();
    if (isGreeting(greetingCheckInput)) {
        console.log(`[UnderstandingService] 👋 Greeting detected via local pattern match — skipping AI. Input: "${workingInput}"`);
        return {
            intent: 'GREETING',
            userRefused: false,
            extractedData: {},
            questions: [],
            corrections: [],
            topicChange: null,
            confidence: 'high',
            continueFlow: false
        };
    }

    // ── Full Stage 1 AI understanding ─────────────────────────────────────────
    const systemPrompt = buildUnderstandingPrompt(ctx);

    let raw = null;
    try {
        raw = await getAIResponse(workingInput, systemPrompt, 2);
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
