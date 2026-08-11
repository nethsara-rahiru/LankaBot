/**
 * conversationService.js
 *
 * Main orchestrator for the FrontDesk Conversation Engine.
 *
 * Pipeline:
 *   1. Build context (contextService)
 *   2. Stage 1: Understand the user message (understandingService)
 *   3. Apply data/corrections to flow runtime (actionService)
 *   4. Handle topic changes or interruptions (actionService)
 *   5. Determine what is still needed (actionService)
 *   6. Stage 2: Generate natural response (responseService)
 *   7. Return response text + metadata for the caller to send & advance the flow
 *
 * The caller (whatsapp.js or simulator) is responsible for:
 *   - Sending the response to the user
 *   - Calling flow.step() or flow.resume() as needed
 */

const { buildContext } = require('./contextService');
const { understandMessage } = require('./understandingService');
const { applyExtractedData, pushInterruption, switchTopic, isCurrentNodeSatisfied, getCurrentRequiredVariable } = require('./actionService');
const { generateResponse } = require('./responseService');

/**
 * Process a user message through the full Conversation Engine pipeline.
 *
 * @param {object} flow         - Active FlowRuntime instance
 * @param {string} userInput    - Raw user message
 * @param {object} [business]   - Business info { name, description, settings }
 * @param {Array}  [catalog]    - Optional catalog items for context
 * @returns {Promise<object>} - Result object:
 *   {
 *     response: string,          — natural language response to send to user
 *     understanding: object,     — Stage 1 AI result
 *     updatedVariables: string[] — list of variables updated this turn
 *     topicChanged: boolean,
 *     interrupted: boolean,
 *     nodeSatisfied: boolean,    — true if current node's variable is now filled
 *     shouldContinueFlow: boolean
 *   }
 */
const processMessage = async (flow, userInput, business = {}, catalog = []) => {
    console.log(`[ConversationService] 🟢 Processing message: "${userInput.substring(0, 80)}"`);

    // --- Step 1: Build context ---
    const ctx = buildContext(flow, userInput, business, catalog);

    // --- Step 2: Stage 1 — Understand the message ---
    const understanding = await understandMessage(ctx);

    // --- Step 3: Apply extracted data and corrections to flow variables ---
    const updatedVariables = applyExtractedData(flow, understanding);

    // --- Step 4: Handle topic change ---
    let topicChanged = false;
    if (understanding.topicChange && understanding.confidence !== 'low') {
        topicChanged = switchTopic(flow, understanding.topicChange);
    }

    // --- Step 5: Handle question-only interruption ---
    // If the user only asked a question and provided nothing new, save the flow state
    // and answer the question without advancing the flow node.
    let interrupted = false;
    const hasQuestions = understanding.questions && understanding.questions.length > 0;
    const hasExtractedData = updatedVariables.length > 0;

    if (hasQuestions && !hasExtractedData && !topicChanged) {
        pushInterruption(flow);
        interrupted = true;
    }

    // --- Step 6: Record user message into conversation history ---
    if (!flow.nodeHistory) flow.nodeHistory = [];
    flow.nodeHistory.push({ role: 'user', content: userInput });

    // --- Step 7: Determine refusal, greeting restart, and what the flow still needs ---
    const isRefusal = understanding.intent === 'REFUSE' || understanding.userRefused === true;
    const isGreeting = understanding.intent === 'GREETING';
    let flowRestarted = false;

    if (isGreeting) {
        console.log(`[ConversationService] 👋 User greeting detected during flow. Restarting flow...`);
        if (flow.compiled) {
            flow.start(flow.compiled);
            flowRestarted = true;
        }
    }

    const nodeSatisfied = isCurrentNodeSatisfied(flow, updatedVariables);
    const nextRequired = (nodeSatisfied || isRefusal || isGreeting) ? null : getCurrentRequiredVariable(flow);

    // If user refused, reset flow status to idle so the user is not trapped in waiting_input
    if (isRefusal) {
        console.log(`[ConversationService] ✋ User refused to answer variable "${getCurrentRequiredVariable(flow)}". Releasing flow lock.`);
        flow.status = 'idle';
    }

    // --- Step 8: Rebuild context with updated variable state for response generation ---
    const updatedCtx = buildContext(flow, userInput, business, catalog);

    // --- Step 9: Stage 2 — Generate natural response ---
    const response = await generateResponse(updatedCtx, understanding, nextRequired);

    // --- Step 10: Record bot response into conversation history ---
    flow.nodeHistory.push({ role: 'bot', content: response });

    const shouldContinueFlow = understanding.continueFlow !== false && !topicChanged && !isRefusal && !isGreeting;

    console.log(`[ConversationService] ✅ Pipeline complete | nodeSatisfied=${nodeSatisfied} | isRefusal=${isRefusal} | isGreeting=${isGreeting} | flowRestarted=${flowRestarted} | topicChanged=${topicChanged} | interrupted=${interrupted} | continueFlow=${shouldContinueFlow}`);

    return {
        response,
        understanding,
        updatedVariables,
        topicChanged,
        interrupted,
        nodeSatisfied,
        isRefusal,
        isGreeting,
        flowRestarted,
        shouldContinueFlow
    };
};

/**
 * Looks at the upcoming nodes in the flow to find the next missing variable.
 * Simple traversal — follows .next pointers from the current node.
 *
 * @param {object} flow - Active FlowRuntime instance
 * @returns {string|null} - Variable name, or null if none found
 */
const _findNextMissingVariable = (flow) => {
    if (!flow || !flow.compiled) return null;

    const steps = flow.compiled.steps || [];
    let nodeId = flow.currentNodeId;
    const visited = new Set();

    // Follow .next chain up to 10 nodes ahead
    for (let i = 0; i < 10; i++) {
        if (!nodeId || visited.has(nodeId)) break;
        visited.add(nodeId);
        const step = steps.find(s => s.id === nodeId);
        if (!step) break;

        if ((step.type === 'get' || step.type === 'getOption') && step.data?.variable) {
            const val = flow.variables[step.data.variable];
            if (val === null || val === undefined || val === '') {
                return step.data.variable;
            }
        }

        nodeId = step.next || null;
    }

    return null;
};

module.exports = { processMessage };
