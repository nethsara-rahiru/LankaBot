/**
 * actionService.js
 *
 * Executes standardized actions derived from the Stage 1 understanding result.
 * Actions modify the FlowRuntime state (variables, node position, interruption stack).
 *
 * Supported action types:
 *   set_variable    — Write a value into flow.variables
 *   correct_variable — Overwrite an existing variable value
 *   switch_topic    — Jump flow to a new topic entrypoint
 *   interrupt_flow  — Push current state onto interruption stack
 *   resume_flow     — Pop interruption stack and restore state
 */

/**
 * Applies extracted data from understanding result into flow variables.
 * Handles both new values and corrections to existing values.
 *
 * @param {object} flow        - Active FlowRuntime instance
 * @param {object} understanding - Result from understandingService.understandMessage()
 * @returns {string[]}         - List of variable names that were updated
 */
const applyExtractedData = (flow, understanding) => {
    const updated = [];

    // Apply fresh extracted data
    if (understanding.extractedData && typeof understanding.extractedData === 'object') {
        for (const [key, value] of Object.entries(understanding.extractedData)) {
            if (value !== undefined && value !== null && value !== '') {
                const prev = flow.variables[key];
                flow.variables[key] = value;
                if (prev !== undefined && prev !== null && prev !== '') {
                    console.log(`[ActionService] 🔄 Updated existing variable "${key}": "${prev}" → "${value}"`);
                } else {
                    console.log(`[ActionService] ✅ Set variable "${key}" = "${JSON.stringify(value)}"`);
                }
                updated.push(key);
            }
        }
    }

    // Apply corrections (explicit overwrites)
    if (Array.isArray(understanding.corrections)) {
        for (const correction of understanding.corrections) {
            if (correction.variable && correction.newValue !== undefined) {
                flow.variables[correction.variable] = correction.newValue;
                console.log(`[ActionService] ✏️  Corrected variable "${correction.variable}": "${correction.oldValue}" → "${correction.newValue}"`);
                if (!updated.includes(correction.variable)) updated.push(correction.variable);
            }
        }
    }

    if (updated.length > 0) {
        flow._emitVariables();
    }

    return updated;
};

/**
 * Pushes current flow state onto the interruption stack.
 * Used when the user asks a side-question and we need to answer it,
 * then resume from exactly where we left off.
 *
 * @param {object} flow - Active FlowRuntime instance
 */
const pushInterruption = (flow) => {
    if (!flow._interruptionStack) flow._interruptionStack = [];
    flow._interruptionStack.push({
        currentNodeId: flow.currentNodeId,
        status: flow.status,
        nodeHistory: [...(flow.nodeHistory || [])]
    });
    console.log(`[ActionService] 📌 Flow interrupted. Saved state at node "${flow.currentNodeId}". Stack depth: ${flow._interruptionStack.length}`);
};

/**
 * Pops the interruption stack and restores the previous flow state.
 *
 * @param {object} flow - Active FlowRuntime instance
 * @returns {boolean} - true if state was restored, false if stack was empty
 */
const popInterruption = (flow) => {
    if (!flow._interruptionStack || flow._interruptionStack.length === 0) {
        console.log('[ActionService] ℹ️  No interruption to resume.');
        return false;
    }
    const state = flow._interruptionStack.pop();
    flow.currentNodeId = state.currentNodeId;
    flow.status = state.status;
    flow.nodeHistory = state.nodeHistory;
    console.log(`[ActionService] 🔙 Restored flow to node "${flow.currentNodeId}". Stack depth: ${flow._interruptionStack.length}`);
    return true;
};

/**
 * Switches the active flow to a different topic entrypoint.
 *
 * @param {object} flow    - Active FlowRuntime instance
 * @param {string} topicId - Target topic ID from compiled.entrypoints
 */
const switchTopic = (flow, topicId) => {
    const entrypoints = flow.compiled?.entrypoints || {};
    const entrypoint = entrypoints[topicId];
    if (!entrypoint) {
        console.warn(`[ActionService] ⚠️  Topic "${topicId}" not found in flow entrypoints.`);
        return false;
    }
    flow.nodeHistory = [];
    flow._interruptionStack = [];
    flow.currentNodeId = entrypoint.id || topicId;
    flow.status = 'running';
    console.log(`[ActionService] 🔀 Switched to topic "${topicId}" → node "${flow.currentNodeId}"`);
    return true;
};

/**
 * Determines which variable the current node is waiting for, if any.
 *
 * @param {object} flow - Active FlowRuntime instance
 * @returns {string|null} - Variable name or null
 */
const getCurrentRequiredVariable = (flow) => {
    if (!flow || !flow.currentNodeId || !flow.compiled) return null;
    const step = (flow.compiled.steps || []).find(s => s.id === flow.currentNodeId);
    return step?.data?.variable || null;
};

/**
 * Checks if the current node's required variable has been provided
 * (either just now or previously).
 *
 * @param {object} flow          - Active FlowRuntime instance
 * @param {string[]} justUpdated - Variable names updated in this turn
 * @returns {boolean}
 */
const isCurrentNodeSatisfied = (flow, justUpdated) => {
    const required = getCurrentRequiredVariable(flow);
    if (!required) return true;
    const value = flow.variables[required];
    const hasValue = value !== null && value !== undefined && value !== '';
    if (hasValue) {
        console.log(`[ActionService] ✅ Current node variable "${required}" is satisfied.`);
    } else {
        console.log(`[ActionService] ⏳ Current node variable "${required}" is still missing.`);
    }
    return hasValue;
};

module.exports = {
    applyExtractedData,
    pushInterruption,
    popInterruption,
    switchTopic,
    getCurrentRequiredVariable,
    isCurrentNodeSatisfied
};
