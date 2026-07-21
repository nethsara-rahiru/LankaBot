/**
 * FlowRuntime
 *
 * A state-machine that executes compiled flow code step by step.
 * The Simulator UI drives this by calling step() and providing user input.
 *
 * Events are emitted via callbacks so the UI can react:
 *   onBotMessage(text)       – bot sends a message
 *   onWaitingForInput(prompt) – bot is waiting for user text
 *   onWaitingForOption(prompt, options) – bot is waiting for user to pick an option
 *   onWait(seconds)          – bot is in a timed wait
 *   onStepChange(nodeId, stepIndex, totalSteps) – active node changed
 *   onVariableUpdate(variables) – variables changed
 *   onFlowEnd()              – flow has finished (no more nodes)
 */
class FlowRuntime {
    constructor() {
        this.compiled = null;
        this.variables = {};
        this.currentNodeId = null;
        this.status = 'idle'; // idle | running | waiting_input | waiting_option | waiting_timer | finished
        this.stepIndex = 0;
        this.executedSteps = [];

        // Callbacks (set by Simulator)
        this.onBotMessage = null;
        this.onWaitingForInput = null;
        this.onWaitingForOption = null;
        this.onWait = null;
        this.onStepChange = null;
        this.onVariableUpdate = null;
        this.onFlowEnd = null;
        this.onAIExtract = null;
    }

    /**
     * Load compiled flow and reset state
     */
    start(compiled) {
        this.compiled = compiled;
        this.variables = { ...compiled.variables };
        this.currentNodeId = compiled.entrypoint;
        this.status = 'running';
        this.stepIndex = 0;
        this.executedSteps = [];
        this._emitVariables();
    }

    /**
     * Reset to beginning
     */
    reset() {
        if (this.compiled) {
            this.start(this.compiled);
        }
    }

    /**
     * Stop the flow
     */
    stop() {
        this.status = 'idle';
        this.currentNodeId = null;
    }

    /**
     * Get the current step object
     */
    _getStep(nodeId) {
        return this.compiled.steps.find(s => s.id === nodeId) || null;
    }

    /**
     * Get total executable steps count
     */
    getTotalSteps() {
        return this.compiled ? this.compiled.steps.filter(s => s.type !== 'start').length : 0;
    }

    /**
     * Execute the current node and advance.
     * For nodes that need user input (get, getOption), execution pauses
     * until step() is called again with userInput.
     *
     * @param {string|null} userInput – text from the user (for get/getOption)
     * @returns {string} status after this step
     */
    step(userInput = null) {
        if (!this.compiled || this.status === 'finished' || this.status === 'idle') {
            return this.status;
        }

        const currentStep = this._getStep(this.currentNodeId);
        if (!currentStep) {
            this.status = 'finished';
            if (this.onFlowEnd) this.onFlowEnd();
            return this.status;
        }

        // Emit step change
        this._emitStepChange(currentStep.id);

        switch (currentStep.type) {
            case 'start':
                // Start node just passes through to next
                this._advance(currentStep.next);
                break;

            case 'say':
                if (this.onBotMessage) {
                    const msg = this._interpolate(currentStep.data.message || '');
                    this.onBotMessage(msg);
                }
                this._advance(currentStep.next);
                break;

            case 'get':
                if (this.status === 'waiting_ai' && userInput !== null) {
                    // AI finished extracting — store in variable
                    const varName = currentStep.data.variable;
                    if (varName) {
                        this.variables[varName] = userInput;
                        this._emitVariables();
                    }
                    this.status = 'running';
                    this._advance(currentStep.next);
                } else if (this.status === 'waiting_input' && userInput !== null) {
                    // User provided input
                    const aiPrompt = currentStep.data.aiPrompt;
                    if (aiPrompt && this.onAIExtract) {
                        this.status = 'waiting_ai';
                        const interpolatedAiPrompt = this._interpolate(aiPrompt);
                        const userPrompt = this._interpolate(currentStep.data.prompt || '');
                        this.onAIExtract({ userInput, userPrompt, aiPrompt: interpolatedAiPrompt, options: [] });
                    } else {
                        // No AI prompt, just store raw input
                        const varName = currentStep.data.variable;
                        if (varName) {
                            this.variables[varName] = userInput;
                            this._emitVariables();
                        }
                        this.status = 'running';
                        this._advance(currentStep.next);
                    }
                } else {
                    // Ask for input
                    this.status = 'waiting_input';
                    if (this.onWaitingForInput) {
                        const prompt = this._interpolate(currentStep.data.prompt || 'Please enter a value:');
                        this.onWaitingForInput(prompt);
                    }
                }
                break;

            case 'getOption':
                if (this.status === 'waiting_ai' && userInput !== null) {
                    const options = currentStep.options || [];
                    const matched = this._matchOption(userInput, options);

                    const varName = currentStep.data.variable;
                    if (varName) {
                        this.variables[varName] = matched ? matched.value : userInput;
                        this._emitVariables();
                    }

                    this.status = 'running';
                    if (matched && matched.next) {
                        this._advance(matched.next);
                    } else {
                        const fallback = options.length > 0 && options[0].next ? options[0].next : null;
                        this._advance(fallback);
                    }
                } else if (this.status === 'waiting_option' && userInput !== null) {
                    const aiPrompt = currentStep.data.aiPrompt;
                    if (aiPrompt && this.onAIExtract) {
                        this.status = 'waiting_ai';
                        const interpolatedAiPrompt = this._interpolate(aiPrompt);
                        const userPrompt = this._interpolate(currentStep.data.prompt || '');
                        const opts = (currentStep.options || []).map(o => o.value);
                        this.onAIExtract({ userInput, userPrompt, aiPrompt: interpolatedAiPrompt, options: opts });
                    } else {
                        // Match user input to an option (case-insensitive fuzzy)
                        const options = currentStep.options || [];
                        const matched = this._matchOption(userInput, options);

                        const varName = currentStep.data.variable;
                        if (varName) {
                            this.variables[varName] = matched ? matched.value : userInput;
                            this._emitVariables();
                        }

                        this.status = 'running';
                        if (matched && matched.next) {
                            this._advance(matched.next);
                        } else {
                            // No match — just go to first option's next or end
                            const fallback = options.length > 0 && options[0].next ? options[0].next : null;
                            this._advance(fallback);
                        }
                    }
                } else {
                    // Show options
                    this.status = 'waiting_option';
                    if (this.onWaitingForOption) {
                        const prompt = this._interpolate(currentStep.data.prompt || 'Choose an option:');
                        const opts = (currentStep.options || []).map(o => o.value);
                        this.onWaitingForOption(prompt, opts);
                    }
                }
                break;

            case 'wait':
                const duration = parseInt(currentStep.data.duration) || 1;
                this.status = 'waiting_timer';
                if (this.onWait) this.onWait(duration);
                // The Simulator will call _advanceAfterWait after the timer
                this._waitTimer = setTimeout(() => {
                    this.status = 'running';
                    this._advance(currentStep.next);
                }, duration * 1000);
                break;

            case 'triggerIf':
                const condition = currentStep.data.condition || '';
                const result = this._evaluateCondition(condition);
                if (result) {
                    this._advance(currentStep.next);
                } else {
                    // Condition failed — skip to end or just stop
                    this.status = 'finished';
                    if (this.onFlowEnd) this.onFlowEnd();
                }
                break;

            default:
                this._advance(currentStep.next);
                break;
        }

        return this.status;
    }

    /**
     * Advance to the next node
     */
    _advance(nextNodeId) {
        if (!nextNodeId) {
            this.status = 'finished';
            if (this.onFlowEnd) this.onFlowEnd();
            return;
        }
        this.currentNodeId = nextNodeId;
        this.stepIndex++;
    }

    /**
     * Replace {{varName}} placeholders in text with variable values
     */
    _interpolate(text) {
        return text.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
            return this.variables[varName] !== undefined && this.variables[varName] !== null
                ? this.variables[varName]
                : match;
        });
    }

    /**
     * Simple option matching (case-insensitive includes)
     */
    _matchOption(input, options) {
        const lower = input.toLowerCase().trim();
        // Exact match first
        let match = options.find(o => o.value.toLowerCase().trim() === lower);
        if (match) return match;
        // Partial match
        match = options.find(o => lower.includes(o.value.toLowerCase().trim()) || o.value.toLowerCase().trim().includes(lower));
        return match || null;
    }

    /**
     * Evaluate a simple condition string like "varName == 'value'"
     * Supports: ==, !=, >, <, >=, <=
     */
    _evaluateCondition(condition) {
        try {
            // Replace variable references with their values
            let expr = condition.replace(/\b([a-zA-Z_]\w*)\b/g, (match) => {
                if (['true', 'false', 'null', 'undefined'].includes(match)) return match;
                if (this.variables.hasOwnProperty(match)) {
                    const val = this.variables[match];
                    return typeof val === 'string' ? `"${val}"` : String(val);
                }
                return match;
            });

            // Evaluate safely using Function constructor (limited scope)
            return new Function(`return (${expr})`)();
        } catch (e) {
            console.warn('Condition evaluation failed:', condition, e);
            return false;
        }
    }

    _emitStepChange(nodeId) {
        this.executedSteps.push(nodeId);
        if (this.onStepChange) {
            this.onStepChange(nodeId, this.stepIndex, this.getTotalSteps());
        }
    }

    _emitVariables() {
        if (this.onVariableUpdate) {
            this.onVariableUpdate({ ...this.variables });
        }
    }
}

// Export for browser
window.FlowRuntime = FlowRuntime;
