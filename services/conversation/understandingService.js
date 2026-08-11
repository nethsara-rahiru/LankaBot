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

// ─── Clear-input fast-path ─────────────────────────────────────────────────────
// Signals that indicate the user is asking a question or is ambiguous.
// When these are absent AND the node has no aiPrompt, we can skip the AI.
const QUESTION_SIGNALS = /[?]|\b(what|who|when|where|why|how|which|can you|do you|is there|are there|will you|tell me|explain|describe)\b/i;

/**
 * Returns true if the input clearly and directly answers a plain data node
 * (no aiPrompt set) — i.e. the user typed a straightforward value with no
 * question marks or interrogative language.
 *
 * @param {object} ctx - Full context from contextService.buildContext()
 * @returns {boolean}
 */
const isClearDirectInput = (ctx) => {
    // Only apply fast-path when there IS a required variable to fill
    const requiredVar = ctx.currentNode?.variable;
    if (!requiredVar) return false;

    // Only when the node has no custom AI prompt (simple data collect)
    if (ctx.currentNode?.aiPrompt) return false;

    const input = (ctx.userInput || '').trim();
    if (!input) return false;

    // Skip if the input looks like a question or contains interrogative words
    if (QUESTION_SIGNALS.test(input)) return false;

    // Skip if the input is suspiciously long (may contain multiple intents)
    const wordCount = input.split(/\s+/).filter(Boolean).length;
    if (wordCount > 12) return false;

    return true;
};

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
6. Greetings / Salutations (e.g. "hi", "hello", "hey", "good morning", "ayubowan", "vanakkam", "halo", etc.)
7. Multiple intents in the same message

IMPORTANT RULES:
- If the user explicitly greets (e.g. "hi", "hello", "hey", "good morning", "ayubowan", etc.), set "intent": "GREETING".
- If the user explicitly refuses, declines, says "skip", "no", "pass", "never mind", "I don't want to share/tell", or indicates they do not want to answer the requested question, set "intent": "REFUSE", "userRefused": true, and "continueFlow": false.
- If the user provides a value for a variable that is already collected, treat it as a CORRECTION (not a new entry).
- If the user asks a question, include it in "questions". Do NOT ignore it.
- Only set "topicChange" if the user is clearly and intentionally switching to a different topic — not for temporary questions.
- For uncertain values, set confidence to "low" and do NOT include the data in extractedData.
- "continueFlow" should be true unless the user is cancelling, refusing to answer, or switching topics.

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

    // ── Fast-path 1: Greeting detection (no AI call) ──────────────────────────
    // Translate common multi-language greetings locally before hitting the AI.
    if (isGreeting(ctx.userInput)) {
        console.log(`[UnderstandingService] 👋 Greeting detected via local pattern match — skipping AI. Input: "${ctx.userInput}"`);
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

    // ── Fast-path 2: Clear direct input (no AI call) ──────────────────────────
    // When a simple `get` node (no aiPrompt) receives unambiguous plain text,
    // skip Stage 1 AI and directly advance the flow node.
    if (isClearDirectInput(ctx)) {
        const requiredVar = ctx.currentNode.variable;
        console.log(`[UnderstandingService] ⚡ Clear direct input detected — skipping AI. Setting "${requiredVar}" = "${ctx.userInput}"`);
        return {
            intent: 'PROVIDE_DATA',
            userRefused: false,
            extractedData: { [requiredVar]: ctx.userInput.trim() },
            questions: [],
            corrections: [],
            topicChange: null,
            confidence: 'high',
            continueFlow: true
        };
    }

    // ── Full Stage 1 AI understanding ─────────────────────────────────────────
    const systemPrompt = buildUnderstandingPrompt(ctx);

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
