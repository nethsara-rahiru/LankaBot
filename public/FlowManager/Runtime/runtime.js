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

        // Interruption stack — preserves flow state during side-questions or topic interruptions.
        // Each entry: { currentNodeId, status, nodeHistory }
        this._interruptionStack = [];

        // Callbacks (set by Simulator or Server)
        this.onBotMessage = null;
        this.onWaitingForInput = null;
        this.onWaitingForOption = null;
        this.onWait = null;
        this.onStepChange = null;
        this.onVariableUpdate = null;
        this.onFlowEnd = null;

        // Legacy extraction callback (still supported as fallback)
        this.onAIExtract = null;

        // New Conversation Engine callback.
        // Signature: async (flow, userInput, business, catalog) => { response, nodeSatisfied, topicChanged, shouldContinueFlow, ... }
        // When set, the Conversation Engine replaces onAIExtract for 'get' and 'getOption' nodes.
        this.onConversationEngine = null;

        this.onShowCatalog = null; // async (itemType) => { items: [...], menuStyle: {...} }
        this.onPlaceOrder = null; // async (orderData) => { order: ... }
        this.onSendMessage = null; // async (phone, message, imageId) => { ... }
    }

    /**
     * Helper to reliably match catalog items by ID, Index, Name, Substring, or Word Overlap
     */
    _findMatchingCatalogItem(catalogItems, valToMatch) {
        if (!valToMatch || !Array.isArray(catalogItems) || catalogItems.length === 0) return null;

        let strVal = '';
        if (typeof valToMatch === 'object') {
            if (valToMatch._id || valToMatch.id) {
                const found = catalogItems.find(i => String(i._id || i.id) === String(valToMatch._id || valToMatch.id));
                if (found) return found;
            }
            strVal = valToMatch.fields?.name || valToMatch.name || valToMatch.fields?.title || valToMatch.title || JSON.stringify(valToMatch);
        } else {
            strVal = String(valToMatch).trim();
        }
        if (!strVal) return null;

        // Extract Item ID or Name if strVal is a formatted AI product string
        const idMatch = strVal.match(/Item ID:\s*["']?([^"'|\n]+)["']?/i);
        if (idMatch && idMatch[1]) {
            const matchedById = catalogItems.find(i => String(i._id || i.id) === idMatch[1].trim());
            if (matchedById) return matchedById;
        }

        const nameMatch = strVal.match(/Name:\s*["']?([^"'|\n]+)["']?/i);
        if (nameMatch && nameMatch[1]) {
            const matchedByName = catalogItems.find(i => {
                const n = i.fields?.name || i.name || i.fields?.title || i.title || '';
                return n.toLowerCase().trim() === nameMatch[1].toLowerCase().trim();
            });
            if (matchedByName) return matchedByName;
        }

        // If the string contains a quoted message payload, try matching the quoted payload first
        const replyMatch = strVal.match(/\[Replying to (?:message: )?["']?([\s\S]*?)["']?\]/i);
        if (replyMatch && replyMatch[1]) {
            const quotedContent = replyMatch[1].trim();
            const cleanWithoutReply = strVal.replace(/\[Replying to (?:message: )?[\s\S]*?\]/gi, '').trim();
            
            const quotedMatchItem = this._findMatchingCatalogItem(catalogItems, quotedContent);
            if (quotedMatchItem) return quotedMatchItem;

            if (cleanWithoutReply) strVal = cleanWithoutReply;
        }

        const normalizeStr = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const normVal = normalizeStr(strVal);

        // 1. Direct ID / Port ID matches
        for (let i = 0; i < catalogItems.length; i++) {
            const item = catalogItems[i];
            const itemId = String(item._id || item.id || '');
            const portId = `cat_${itemId}`;
            if (strVal === itemId || strVal === portId || (normVal && (normVal === normalizeStr(itemId) || normVal === normalizeStr(portId)))) {
                return item;
            }
        }

        // 2. Index number matches (e.g. "1", "2", "option 1", "item #2", "choice 1")
        // STRICT: Only match as index if strVal is explicitly an option index selection, NOT a product name with numbers like "500ml" or "2L"
        let indexNum = null;
        if (/^\s*\d+\s*$/.test(strVal)) {
            indexNum = parseInt(strVal.trim(), 10);
        } else if (/^\s*(?:option|item|choice|number|#)\s*:?\s*(\d+)\s*$/i.test(strVal)) {
            const m = strVal.match(/(\d+)/);
            if (m) indexNum = parseInt(m[1], 10);
        } else if (/^\s*(\d+)[\.\s\-]+\D/i.test(strVal)) {
            const m = strVal.match(/^\s*(\d+)[\.\s\-]/);
            if (m) indexNum = parseInt(m[1], 10);
        }

        if (indexNum !== null) {
            const idx = indexNum - 1;
            if (idx >= 0 && idx < catalogItems.length) {
                return catalogItems[idx];
            }
        }

        // Clean string value by removing option numbers (e.g. "1. ") and trailing details (e.g. "(Rs. 180, Dairy)")
        const cleanNameVal = strVal
            .replace(/^\s*\d+[\.\s\-]+/, '')
            .replace(/\s*\([^)]*\)/g, '')
            .trim();
        const normCleanVal = normalizeStr(cleanNameVal);

        // 3. Exact name / normalized name & sub-name match
        for (let i = 0; i < catalogItems.length; i++) {
            const item = catalogItems[i];
            const name = item.fields?.name || item.name || item.fields?.title || item.title || '';
            const normName = normalizeStr(name);

            if (name.toLowerCase().trim() === strVal.toLowerCase().trim() || name.toLowerCase().trim() === cleanNameVal.toLowerCase().trim()) {
                return item;
            }
            if (normName && (normName === normVal || normName === normCleanVal)) {
                return item;
            }

            // Match sub-names inside parentheses e.g. "ඩෙවිල් කජු ( Devilled Cashews )"
            if (name.includes('(') && name.includes(')')) {
                const parts = name.split(/[\(\)]/).map(p => p.trim()).filter(Boolean);
                for (const part of parts) {
                    const normPart = normalizeStr(part);
                    if (part.toLowerCase() === strVal.toLowerCase() || part.toLowerCase() === cleanNameVal.toLowerCase()) {
                        return item;
                    }
                    if (normPart && (normPart === normVal || normPart === normCleanVal)) {
                        return item;
                    }
                }
            }
        }

        // 4. Substring & Semantic Token Overlap Scoring
        const tokenize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1);
        const valTokens = tokenize(cleanNameVal || strVal);

        let bestItem = null;
        let bestScore = 0;

        catalogItems.forEach((item) => {
            const name = item.fields?.name || item.name || item.fields?.title || item.title || '';
            const category = item.fields?.category || item.category || '';
            const description = item.fields?.description || item.description || '';
            const normName = normalizeStr(name);
            const normCat = normalizeStr(category);
            const fullText = `${name} ${category} ${description}`;
            const itemTokens = tokenize(fullText);

            let score = 0;

            if (normName) {
                if (normVal === normName || normCleanVal === normName) score += 100;
                else if (normVal.includes(normName) || normCleanVal.includes(normName)) score += 80;
                else if (normName.includes(normVal) && normVal.length >= 3) score += 70;
                else if (normCleanVal && normName.includes(normCleanVal) && normCleanVal.length >= 3) score += 70;
            }

            if (normCat && (normVal.includes(normCat) || normCleanVal.includes(normCat))) score += 30;

            if (valTokens.length > 0 && itemTokens.length > 0) {
                let matchCount = 0;
                valTokens.forEach(vt => {
                    if (itemTokens.some(it => it.includes(vt) || vt.includes(it))) {
                        matchCount++;
                    }
                });
                const tokenScore = (matchCount / valTokens.length) * 60;
                score += tokenScore;
            }

            if (score > bestScore) {
                bestScore = score;
                bestItem = item;
            }
        });

        if (bestScore >= 30) {
            return bestItem;
        }

        return null;
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
    async step(userInput = null) {
        if (!this.compiled || this.status === 'finished' || this.status === 'idle') {
            console.log(`[FlowRuntime] ⏹️ Step called but runtime status is '${this.status}' (compiled present: ${!!this.compiled})`);
            return this.status;
        }

        const currentStep = this._getStep(this.currentNodeId);
        if (!currentStep) {
            console.log(`[FlowRuntime] 🏁 No step found for node ID '${this.currentNodeId}'. Flow finished.`);
            this.status = 'finished';
            if (this.onFlowEnd) this.onFlowEnd();
            return this.status;
        }

        console.log(`[FlowRuntime] ⏩ Step starting: Node ID '${currentStep.id}' (Type: '${currentStep.type}') | Current Status: '${this.status}' | Input: ${userInput !== null ? `"${userInput}"` : 'null'}`);

        // Emit step change
        this._emitStepChange(currentStep.id);

        switch (currentStep.type) {
            case 'start':
            case 'newFlow':
                // Start and newFlow nodes just pass through to next
                this._advance(currentStep.next);
                break;

            case 'say':
                if (this.onBotMessage) {
                    const msg = this._interpolate(currentStep.data.message || '');
                    const mediaId = currentStep.data.mediaId ? this._interpolate(currentStep.data.mediaId) : null;
                    await this.onBotMessage(msg, mediaId);
                }
                this._advance(currentStep.next);
                break;

            case 'sendMessage':
                const rawPhone = currentStep.data.phone || currentStep.data.phoneNumber || '';
                const targetPhone = this._interpolate(rawPhone);
                const sendMsgText = this._interpolate(currentStep.data.message || '');
                const rawImageId = currentStep.data.imageId || currentStep.data.mediaId || '';
                const imageId = rawImageId ? this._interpolate(rawImageId) : null;

                if (this.onSendMessage) {
                    try {
                        await this.onSendMessage(targetPhone, sendMsgText, imageId);
                    } catch (err) {
                        console.error('[FlowRuntime] ❌ Error in onSendMessage callback:', err);
                    }
                } else if (this.onBotMessage) {
                    await this.onBotMessage(`[Send Message to ${targetPhone}]: ${sendMsgText}`, imageId);
                }
                this._advance(currentStep.next);
                break;

            case 'get':
                // ─── Conversation Engine path (new) ────────────────────────────────────
                // When onConversationEngine is wired (production WhatsApp bot), the entire
                // understanding + response generation is handled externally. The callback
                // receives the flow instance, understands the message holistically, applies
                // variables, generates the response, sends it, and then calls flow.step()
                // with either '__ce_satisfied__' (node variable filled) or '__ce_pending__'
                // (still waiting for more input) so the runtime knows what to do next.
                if (this.onConversationEngine && (this.status === 'waiting_input' || this.status === 'waiting_ce') && userInput !== null) {
                    if (userInput === '__ce_satisfied__') {
                        // Conversation Engine has already set the variable and sent the response.
                        // Advance the flow to the next node.
                        console.log(`[FlowRuntime][get] ✅ CE satisfied variable "${currentStep.data.variable}". Advancing.`);
                        this.status = 'running';
                        this._advance(currentStep.next);
                    } else if (userInput === '__ce_pending__') {
                        // CE answered questions but still needs the variable. Stay here.
                        console.log(`[FlowRuntime][get] ⏳ CE pending — waiting for "${currentStep.data.variable}".`);
                        this.status = 'waiting_input';
                    } else {
                        // First user message — hand off to Conversation Engine.
                        this.status = 'waiting_ce';
                        this.onConversationEngine(this, userInput);
                    }
                    break;
                }

                // ─── Legacy onAIExtract path (original, preserved as fallback) ─────────
                if (this.status === 'waiting_ai' && userInput !== null) {
                    try {
                        let parsed = null;
                        const cleanInput = (typeof userInput === 'string') ? userInput.replace(/```json/gi, '').replace(/```/g, '').trim() : userInput;
                        try {
                            const jsonMatch = cleanInput.match(/\{[\s\S]*\}/);
                            if (jsonMatch) {
                                parsed = JSON.parse(jsonMatch[0]);
                            } else {
                                parsed = JSON.parse(cleanInput);
                            }
                        } catch(e) {
                            // If AI failed to return any JSON, construct a fallback that carries forward the raw user input as followUp
                            parsed = { status: 'fail', followUp: `Thank you for your response ("${userInput}"). Could you please provide the specific detail required so we can assist you?` };
                        }

                        if (parsed.status === 'redirect' && parsed.topicId) {
                            this.nodeHistory = [];
                            const entrypoint = this.compiled.entrypoints && this.compiled.entrypoints[parsed.topicId];
                            this.currentNodeId = entrypoint ? entrypoint.id : parsed.topicId;
                            this.status = 'running';
                            await this.step(null);
                            return this.status;
                        }

                        if (parsed.status === 'fail') {
                            if (this.onBotMessage && parsed.followUp) {
                                await this.onBotMessage(parsed.followUp);
                                if (!this.nodeHistory) this.nodeHistory = [];
                                this.nodeHistory.push({ role: 'bot', content: parsed.followUp });
                            }
                            this.status = 'waiting_input'; // Wait for input again
                            return this.status;
                        }

                        this.nodeHistory = []; // clear history on success

                        const varName = currentStep.data.variable;
                        if (varName) {
                            this.variables[varName] = parsed.value !== undefined ? parsed.value : userInput;
                            this._emitVariables();
                        }
                        this.status = 'running';
                        this._advance(currentStep.next);
                    } catch(e) {
                        this.status = 'running';
                        this._advance(currentStep.next);
                    }
                } else if (this.status === 'waiting_input' && userInput !== null) {
                    // User provided input
                    if (this.onAIExtract) {
                        this.status = 'waiting_ai';
                        const aiPrompt = currentStep.data.aiPrompt;
                        const interpolatedAiPrompt = aiPrompt ? this._interpolate(aiPrompt) : '';
                        const userPrompt = this._interpolate(currentStep.data.prompt || '');
                        
                        if (!this.nodeHistory) this.nodeHistory = [];
                        this.nodeHistory.push({ role: 'user', content: userInput });
                        
                        const currentTopic = this._getCurrentTopicContext();
                        const fullContext = this.nodeHistory.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
                        const entrypoints = this.compiled && this.compiled.entrypoints ? this.compiled.entrypoints : {};
                        const flowTopics = Object.keys(entrypoints).map(k => `- Topic ID: ${k}, Description: ${entrypoints[k].description || 'No description provided'}`).join('\n');

                        this.onAIExtract({
                            userInput: fullContext,
                            userPrompt,
                            aiPrompt: interpolatedAiPrompt,
                            options: [],
                            expectJson: true,
                            flowTopics,
                            currentTopicId: currentTopic.id,
                            currentTopicDescription: currentTopic.description,
                            noAiPrompt: !aiPrompt
                        });
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
                        await this.onWaitingForInput(prompt);
                    }
                }
                break;

            case 'getOption':
                // ─── Conversation Engine path (new) ────────────────────────────────────
                // CE handles natural language option selection, questions, and ambiguity.
                // The CE resolves the option, sets the variable, and sends the response.
                // It then calls flow.step() with '__ce_satisfied__' (matched + next branch
                // stored in flow._cePendingNext) or '__ce_pending__' (still ambiguous).
                if (this.onConversationEngine && (this.status === 'waiting_option' || this.status === 'waiting_ce') && userInput !== null) {
                    if (userInput === '__ce_satisfied__') {
                        const varName = currentStep.data.variable;
                        const options = currentStep.options || [];
                        // The CE has already applied the variable. Find the matched branch.
                        const resolvedVal = varName ? this.variables[varName] : null;
                        const matched = resolvedVal ? this._matchOption(resolvedVal, options) : null;
                        this.status = 'running';
                        if (matched && matched.next) {
                            console.log(`[FlowRuntime][getOption] ✅ CE satisfied — matched option "${matched.value}", advancing to "${matched.next}".`);
                            this._advance(matched.next);
                        } else {
                            const fallback = options.length > 0 && options[0].next ? options[0].next : null;
                            console.log(`[FlowRuntime][getOption] ✅ CE satisfied — no exact branch, using fallback "${fallback}".`);
                            this._advance(fallback);
                        }
                    } else if (userInput === '__ce_pending__') {
                        console.log(`[FlowRuntime][getOption] ⏳ CE pending — waiting for unambiguous option selection.`);
                        this.status = 'waiting_option';
                    } else {
                        // First user message — hand off to Conversation Engine.
                        this.status = 'waiting_ce';
                        this.onConversationEngine(this, userInput);
                    }
                    break;
                }

                // ─── Legacy onAIExtract path (original, preserved as fallback) ─────────
                if (this.status === 'waiting_ai' && userInput !== null) {
                    try {
                        let parsed = null;
                        const cleanInput = (typeof userInput === 'string') ? userInput.replace(/```json/gi, '').replace(/```/g, '').trim() : userInput;
                        try {
                            const jsonMatch = cleanInput.match(/\{[\s\S]*\}/);
                            if (jsonMatch) {
                                parsed = JSON.parse(jsonMatch[0]);
                            } else {
                                parsed = JSON.parse(cleanInput);
                            }
                        } catch(e) {
                            parsed = { status: 'fail', followUp: `Thank you for your message. Please select one of the available options so we can assist you.` };
                        }

                        if (parsed.status === 'redirect' && parsed.topicId) {
                            this.nodeHistory = [];
                            const entrypoint = this.compiled.entrypoints && this.compiled.entrypoints[parsed.topicId];
                            this.currentNodeId = entrypoint ? entrypoint.id : parsed.topicId;
                            this.status = 'running';
                            await this.step(null);
                            return this.status;
                        }

                        if (parsed.status === 'fail') {
                            if (this.onBotMessage && parsed.followUp) {
                                await this.onBotMessage(parsed.followUp);
                                if (!this.nodeHistory) this.nodeHistory = []
                                this.nodeHistory.push({ role: 'bot', content: parsed.followUp });
                            }
                            this.status = 'waiting_option';
                            return this.status;
                        }

                        this.nodeHistory = [];

                        const val = parsed.value !== undefined ? parsed.value : userInput;
                        const options = currentStep.options || [];
                        const matched = this._matchOption(val, options);

                        const varName = currentStep.data.variable;
                        if (varName) {
                            this.variables[varName] = matched ? matched.value : val;
                            this._emitVariables();
                        }

                        this.status = 'running';
                        if (matched && matched.next) {
                            this._advance(matched.next);
                        } else {
                            const fallback = options.length > 0 && options[0].next ? options[0].next : null;
                            this._advance(fallback);
                        }
                    } catch(e) {
                        this.status = 'running';
                        this._advance(currentStep.next);
                    }
                } else if (this.status === 'waiting_option' && userInput !== null) {
                    if (this.onAIExtract) {
                        this.status = 'waiting_ai';
                        const aiPrompt = currentStep.data.aiPrompt;
                        const interpolatedAiPrompt = aiPrompt ? this._interpolate(aiPrompt) : '';
                        const userPrompt = this._interpolate(currentStep.data.prompt || '');
                        const opts = (currentStep.options || []).map(o => o.value);
                        
                        if (!this.nodeHistory) this.nodeHistory = [];
                        this.nodeHistory.push({ role: 'user', content: userInput });
                        const currentTopic = this._getCurrentTopicContext();
                        const fullContext = this.nodeHistory.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
                        const entrypoints = this.compiled && this.compiled.entrypoints ? this.compiled.entrypoints : {};
                        const flowTopics = Object.keys(entrypoints).map(k => `- Topic ID: ${k}, Description: ${entrypoints[k].description || 'No description provided'}`).join('\n');

                        this.onAIExtract({
                            userInput: fullContext,
                            userPrompt,
                            aiPrompt: interpolatedAiPrompt,
                            options: opts,
                            expectJson: true,
                            flowTopics,
                            currentTopicId: currentTopic.id,
                            currentTopicDescription: currentTopic.description,
                            noAiPrompt: !aiPrompt
                        });
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
                        await this.onWaitingForOption(prompt, opts);
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

            case 'if':
                const var1 = this._interpolate(currentStep.data.var1 || '');
                const var2 = this._interpolate(currentStep.data.var2 || '');
                const op = currentStep.data.condition || '==';
                
                let result = false;
                try {
                    // Safe evaluation
                    const v1 = isNaN(Number(var1)) ? `"${var1}"` : var1;
                    const v2 = isNaN(Number(var2)) ? `"${var2}"` : var2;
                    result = new Function(`return ${v1} ${op} ${v2}`)();
                } catch(e) {
                    result = false;
                }

                if (result) {
                    this._advance(currentStep.nextTrue);
                } else {
                    this._advance(currentStep.nextFalse);
                }
                break;

            case 'ifAI':
                if (this.status === 'waiting_ai' && userInput !== null) {
                    let result = false;
                    try {
                        const cleanInput = (typeof userInput === 'string') ? userInput.replace(/```json/gi, '').replace(/```/g, '').trim() : userInput;
                        const parsed = JSON.parse(cleanInput);
                        result = parsed.value === true || parsed.value === 'true';
                    } catch(e) {
                        result = (userInput || '').toLowerCase().includes('true');
                    }

                    this.status = 'running';
                    if (result) {
                        this._advance(currentStep.nextTrue);
                    } else {
                        this._advance(currentStep.nextFalse);
                    }
                } else {
                    this.status = 'waiting_ai';
                    if (this.onAIExtract) {
                        const prompt = this._interpolate(currentStep.data.prompt || '');
                        this.onAIExtract({ userInput: 'Evaluate boolean', userPrompt: '', aiPrompt: prompt, options: [], expectJson: true, isBoolean: true });
                    } else {
                        this.status = 'running';
                        this._advance(currentStep.nextFalse);
                    }
                }
                break;

            case 'showCatalog': {
                const showCatType = currentStep.data.itemType || '';
                const requestedStyleName = currentStep.data.menuStyle || currentStep.data.menuStyleName || '';
                try {
                    let items = [];
                    let menuStyle = {
                        header: '🛍️ *OUR CATALOG*',
                        itemFormat: '• *{{name}}*\n  Price: Rs. {{price}}\n  _{{category}}_',
                        footer: 'Type item name to order!'
                    };

                    const pickStyle = (stylesArray, defaultSingleStyle) => {
                        if (Array.isArray(stylesArray) && stylesArray.length > 0) {
                            if (requestedStyleName) {
                                const found = stylesArray.find(s => String(s.name || '').toLowerCase() === String(requestedStyleName).toLowerCase());
                                if (found) return found;
                            }
                            return stylesArray[0];
                        }
                        return defaultSingleStyle || menuStyle;
                    };

                    if (this.onShowCatalog) {
                        // Server-side: delegate to callback
                        const result = await this.onShowCatalog(showCatType, requestedStyleName);
                        if (result) {
                            items = result.items || [];
                            menuStyle = pickStyle(result.menuStyles, result.menuStyle);
                        }
                    } else {
                        // Browser/simulator fallback: fetch from API
                        const accountId = (typeof localStorage !== 'undefined') ? localStorage.getItem('activeAccountId') : null;
                        const simToken = (typeof localStorage !== 'undefined') ? localStorage.getItem('token') : null;
                        const headers = { 'x-auth-token': simToken || '' };
                        if (accountId) headers['x-account-id'] = accountId;

                        const [catRes, settRes] = await Promise.all([
                            fetch(`/api/catalog${showCatType ? '?type=' + showCatType : ''}`, { headers }),
                            fetch('/api/settings', { headers })
                        ]);
                        if (catRes.ok) items = await catRes.json();
                        if (settRes.ok) {
                            const sett = await settRes.json();
                            menuStyle = pickStyle(sett.menuStyles, sett.menuStyle);
                        }
                    }

                    const applyVars = (template, item) => {
                        if (!template) return '';
                        const variants = Array.isArray(item.fields?.variants) ? item.fields.variants : [];
                        let priceVal = item.fields?.price !== undefined ? item.fields.price : '';
                        let variantsStr = '';

                        if (variants.length > 0) {
                            variantsStr = 'Variants:\n' + variants.map(v => `  - ${v.name}: Rs. ${v.price}`).join('\n');
                            if (!priceVal || priceVal === 'N/A') {
                                const prices = variants.map(v => Number(v.price)).filter(p => !isNaN(p));
                                if (prices.length > 0) {
                                    const min = Math.min(...prices);
                                    const max = Math.max(...prices);
                                    priceVal = min === max ? `${min}` : `${min} - ${max}`;
                                }
                            }
                        }

                        return template
                            .replace(/\{\{name\}\}/g, item.fields?.name || '')
                            .replace(/\{\{price\}\}/g, priceVal !== '' ? priceVal : 'N/A')
                            .replace(/\{\{category\}\}/g, item.fields?.category || '')
                            .replace(/\{\{type\}\}/g, item.type || '')
                            .replace(/\{\{status\}\}/g, item.status || 'available')
                            .replace(/\{\{variants\}\}/g, variantsStr);
                    };

                    if (items.length === 0) {
                        if (this.onBotMessage) await this.onBotMessage(`[No ${showCatType || 'catalog'} items found]`);
                    } else {
                        // Header — sent once with first item's vars
                        if (menuStyle.header && this.onBotMessage) {
                            await this.onBotMessage(applyVars(menuStyle.header, items[0]));
                        }
                        // Each item as its own message (attaching imageId/mediaId if available)
                        for (const item of items) {
                            const itemMsg = applyVars(menuStyle.itemFormat, item);
                            const mediaId = item.fields?.imageId || item.fields?.mediaId || null;
                            if (itemMsg && this.onBotMessage) await this.onBotMessage(itemMsg, mediaId);
                        }
                        // Footer — sent once with last item's vars
                        if (menuStyle.footer && this.onBotMessage) {
                            await this.onBotMessage(applyVars(menuStyle.footer, items[items.length - 1]));
                        }
                    }
                } catch (err) {
                    if (this.onBotMessage) await this.onBotMessage(`[Show Catalog: Error — ${err.message}]`);
                }
                this._advance(currentStep.next);
                break;
            }

            case 'catalogSelector': {
                console.log('[CatalogSelector] step.next =', currentStep.next, '| step:', JSON.stringify({ id: currentStep.id, type: currentStep.type, next: currentStep.next }));
                const showCatType = currentStep.data.itemType || '';
                
                // Fetch catalog items for option selection
                let catalogItems = [];
                try {
                    if (this.onShowCatalog) {
                        const result = await this.onShowCatalog(showCatType);
                        if (result) catalogItems = result.items || [];
                    } else {
                        const accountId = (typeof localStorage !== 'undefined') ? localStorage.getItem('activeAccountId') : null;
                        const simToken = (typeof localStorage !== 'undefined') ? localStorage.getItem('token') : null;
                        const headers = { 'x-auth-token': simToken || '' };
                        if (accountId) headers['x-account-id'] = accountId;
                        const catRes = await fetch(`/api/catalog${showCatType ? '?type=' + showCatType : ''}`, { headers });
                        if (catRes.ok) catalogItems = await catRes.json();
                    }
                } catch (e) {
                    console.error('Error fetching catalog items for selector:', e);
                }

                // If no items in database, create fallback sample items
                if (catalogItems.length === 0) {
                    catalogItems = [
                        { _id: 'item_1', type: 'product', fields: { name: 'Fresh Milk 500ml', price: 180, category: 'Dairy' } },
                        { _id: 'item_2', type: 'service', fields: { name: 'Hair Cut & Styling', price: 1500, category: 'Salon' } }
                    ];
                }

                const optionsList = catalogItems.map((item, idx) => {
                    const name = item.fields?.name || item.name || 'Unnamed Item';
                    const price = item.fields?.price !== undefined ? item.fields.price : (item.price !== undefined ? item.price : 'N/A');
                    const category = item.fields?.category || item.category || '';
                    const description = item.fields?.description || item.description || '';
                    const itemType = item.type || '';

                    let str = `${idx + 1}. Item ID: "${item._id || item.id || idx + 1}" | Name: "${name}"`;
                    if (price !== 'N/A') str += ` | Price: Rs. ${price}`;
                    if (category) str += ` | Category: "${category}"`;
                    if (itemType) str += ` | Type: "${itemType}"`;
                    if (description) str += ` | Description: "${description}"`;
                    return str;
                });

                if (this.status === 'waiting_ai' && userInput !== null) {
                    try {
                        let parsed = null;
                        const cleanInput = (typeof userInput === 'string') ? userInput.replace(/```json/gi, '').replace(/```/g, '').trim() : userInput;
                        try {
                            const jsonMatch = cleanInput.match(/\{[\s\S]*\}/);
                            if (jsonMatch) {
                                parsed = JSON.parse(jsonMatch[0]);
                            } else {
                                parsed = JSON.parse(cleanInput);
                            }
                        } catch(e) {
                            parsed = { status: 'fail', followUp: `Thank you for your message. Please select an available product/service from our catalog so we can assist you.` };
                        }

                        console.log(`[CatalogSelector Node ${currentStep.id}] AI response parsed:`, JSON.stringify(parsed));

                        if (parsed.status === 'redirect' && parsed.topicId) {
                            this.nodeHistory = [];
                            const entrypoint = this.compiled.entrypoints && this.compiled.entrypoints[parsed.topicId];
                            this.currentNodeId = entrypoint ? entrypoint.id : parsed.topicId;
                            this.status = 'running';
                            await this.step(null);
                            return this.status;
                        }

                        const val = parsed.value !== undefined ? parsed.value : null;

                        // Extract actual original user message from nodeHistory (not the AI JSON response string)
                        let realUserMsg = null;
                        if (Array.isArray(this.nodeHistory) && this.nodeHistory.length > 0) {
                            const userEntries = this.nodeHistory.filter(m => typeof m === 'object' && m.role === 'user');
                            if (userEntries.length > 0) {
                                realUserMsg = userEntries[userEntries.length - 1].content;
                            }
                        }

                        // Match selected item object using robust multi-strategy matching
                        let selectedItem = this._findMatchingCatalogItem(catalogItems, val);

                        if (!selectedItem && realUserMsg) {
                            selectedItem = this._findMatchingCatalogItem(catalogItems, realUserMsg);
                        }

                        if (!selectedItem) {
                            selectedItem = this._findMatchingCatalogItem(catalogItems, cleanInput);
                        }

                        if (selectedItem) {
                            console.log(`[CatalogSelector Node ${currentStep.id}] 💡 Item matched successfully: "${selectedItem.fields?.name || selectedItem.name}"`);
                            parsed = { status: 'success', value: selectedItem.fields?.name || selectedItem.name };
                        }

                        if (!selectedItem && parsed.status === 'fail') {
                            console.warn(`[CatalogSelector Node ${currentStep.id}] ⚠️ Selection failed for input: "${realUserMsg || cleanInput}"`);
                            if (this.onBotMessage && parsed.followUp) {
                                await this.onBotMessage(parsed.followUp);
                                if (!this.nodeHistory) this.nodeHistory = [];
                                this.nodeHistory.push({ role: 'bot', content: parsed.followUp });
                            }
                            this.status = 'waiting_option';
                            return this.status;
                        }

                        if (!selectedItem) {
                            selectedItem = catalogItems[0];
                        }

                        this.nodeHistory = [];
                        const itemName = selectedItem ? (selectedItem.fields?.name || selectedItem.name || 'Selected Item') : 'Selected Item';
                        console.log(`[CatalogSelector Node ${currentStep.id}] ✅ Selected item matched: "${itemName}" (ID: ${selectedItem?._id || 'N/A'})`);

                        const varName = currentStep.data.variable;
                        if (varName) {
                            this.variables[varName] = selectedItem;
                            console.log(`[CatalogSelector Node ${currentStep.id}] 💾 Saved selected item object to variable: "${varName}"`);
                            this._emitVariables();
                        }

                        // Determine item-specific next branch if configured
                        const itemPortId = `cat_${selectedItem?._id || selectedItem?.id}`;
                        const matchedOpt = (currentStep.options || []).find(opt => opt.id === itemPortId);
                        const nextTarget = (matchedOpt && matchedOpt.next) ? matchedOpt.next : currentStep.next;

                        this.status = 'running';
                        console.log(`[CatalogSelector Node ${currentStep.id}] ➡️ Advancing to next step: "${nextTarget}"`);
                        this._advance(nextTarget);
                    } catch(e) {
                        console.error(`[CatalogSelector Node ${currentStep.id}] ❌ Exception during step execution:`, e);
                        this.status = 'running';
                        this._advance(currentStep.next);
                    }
                } else if (this.status === 'waiting_option' && userInput !== null) {
                    if (this.onAIExtract) {
                        this.status = 'waiting_ai';
                        const customPrompt = currentStep.data.aiPrompt ? this._interpolate(currentStep.data.aiPrompt) : '';
                        const defaultAiPrompt = `Analyze the user message and conversation history to select the EXACT catalog item the customer wants from the catalog list below:

${optionsList.join('\n')}

INSTRUCTIONS FOR AI:
1. Compare user message, item names, descriptions, categories, item IDs, and Singlish/Tamil transliterations (e.g. "devil kaju" = Devilled Cashews / ඩෙවිල් කජු, "roast kaju" = Roasted Cashews).
2. If the user refers to a product by its name, description keywords, category, number, or flavor, you MUST match it to the exact Item ID or Name and output status: "success".
3. Return JSON: {"status": "success", "value": "matched_item_name_or_id"}
4. DO NOT return status "fail" if a matching or relevant catalog item exists in the list above.
5. Only return status "fail" with a followUp question if the user message is completely unrelated to any item in the catalog.`;

                        const interpolatedAiPrompt = customPrompt
                            ? `${customPrompt}\n\nAvailable Catalog Items with full descriptions:\n${optionsList.join('\n')}`
                            : defaultAiPrompt;

                        const userPrompt = this._interpolate(currentStep.data.prompt || 'Which catalog item would you like to select?');
                        
                        if (!this.nodeHistory) this.nodeHistory = [];
                        this.nodeHistory.push({ role: 'user', content: userInput });
                        const currentTopic = this._getCurrentTopicContext();
                        const fullContext = this.nodeHistory.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
                        const entrypoints = this.compiled && this.compiled.entrypoints ? this.compiled.entrypoints : {};
                        const flowTopics = Object.keys(entrypoints).map(k => `- Topic ID: ${k}, Description: ${entrypoints[k].description || 'No description provided'}`).join('\n');

                        this.onAIExtract({
                            userInput: fullContext,
                            userPrompt,
                            aiPrompt: interpolatedAiPrompt,
                            options: optionsList,
                            expectJson: true,
                            flowTopics,
                            currentTopicId: currentTopic.id,
                            currentTopicDescription: currentTopic.description,
                            noAiPrompt: false
                        });
                    } else {
                        // Match user input directly using multi-strategy finder
                        let selectedItem = this._findMatchingCatalogItem(catalogItems, userInput) || catalogItems[0];

                        const varName = currentStep.data.variable;
                        if (varName) {
                            this.variables[varName] = selectedItem;
                            this._emitVariables();
                        }

                        const itemPortId = `cat_${selectedItem?._id || selectedItem?.id}`;
                        const matchedOpt = (currentStep.options || []).find(opt => opt.id === itemPortId);
                        const nextTarget = (matchedOpt && matchedOpt.next) ? matchedOpt.next : currentStep.next;

                        this.status = 'running';
                        this._advance(nextTarget);
                    }
                } else {
                    // Ask user for catalog item choice
                    this.status = 'waiting_option';
                    if (this.onWaitingForOption) {
                        const prompt = this._interpolate(currentStep.data.prompt || 'Which item would you like to choose from our catalog?');
                        await this.onWaitingForOption(prompt, optionsList);
                    }
                }
                break;
            }

            case 'variantSelector': {
                console.log('[VariantSelector] step.next =', currentStep.next, '| step:', JSON.stringify({ id: currentStep.id, type: currentStep.type, next: currentStep.next }));
                const mode = currentStep.data.productMode || 'dropdown';
                const productId = currentStep.data.productId || '';
                const productVarName = currentStep.data.productVariable || 'selectedItem';
                
                let targetProduct = null;

                if (mode === 'dropdown' && productId) {
                    try {
                        if (this.onShowCatalog) {
                            const result = await this.onShowCatalog('');
                            if (result && Array.isArray(result.items)) {
                                targetProduct = result.items.find(i => String(i._id || i.id) === String(productId));
                            }
                        } else {
                            const accountId = (typeof localStorage !== 'undefined') ? localStorage.getItem('activeAccountId') : null;
                            const simToken = (typeof localStorage !== 'undefined') ? localStorage.getItem('token') : null;
                            const headers = { 'x-auth-token': simToken || '' };
                            if (accountId) headers['x-account-id'] = accountId;
                            const catRes = await fetch(`/api/catalog`, { headers });
                            if (catRes.ok) {
                                const allItems = await catRes.json();
                                targetProduct = allItems.find(i => String(i._id || i.id) === String(productId));
                            }
                        }
                    } catch (e) {
                        console.error('Error fetching catalog product for variant selector:', e);
                    }
                } else {
                    const varVal = this.variables[productVarName];
                    if (typeof varVal === 'object' && varVal !== null) {
                        targetProduct = varVal;
                    } else if (typeof varVal === 'string') {
                        const resolvedId = this._interpolate(varVal || productVarName);
                        try {
                            if (this.onShowCatalog) {
                                const result = await this.onShowCatalog('');
                                if (result && Array.isArray(result.items)) {
                                    targetProduct = result.items.find(i => String(i._id || i.id) === String(resolvedId) || (i.fields?.name && i.fields.name.toLowerCase() === resolvedId.toLowerCase()));
                                }
                            }
                        } catch (e) {}
                    }
                }

                let variants = [];
                if (targetProduct) {
                    if (Array.isArray(targetProduct.fields?.variants)) {
                        variants = targetProduct.fields.variants;
                    } else if (Array.isArray(targetProduct.variants)) {
                        variants = targetProduct.variants;
                    }
                }

                const productName = targetProduct?.fields?.name || targetProduct?.name || 'Product';

                if (variants.length === 0) {
                    console.warn(`[VariantSelector Node ${currentStep.id}] No variants found for product "${productName}". Advancing.`);
                    if (this.onBotMessage) {
                        await this.onBotMessage(`No specific variants available for ${productName}. Standard item selected.`);
                    }
                    const varName = currentStep.data.variable;
                    if (varName) {
                        this.variables[varName] = { name: 'Standard', price: targetProduct?.fields?.price || targetProduct?.price || 0 };
                        this._emitVariables();
                    }
                    this.status = 'running';
                    this._advance(currentStep.next);
                    break;
                }

                const variantOptionsList = variants.map((v, idx) => {
                    const name = v.name || v.label || `Variant ${idx + 1}`;
                    const price = v.price !== undefined ? ` (Rs. ${v.price})` : '';
                    return `${name}${price}`;
                });

                if (this.status === 'waiting_ai' && userInput !== null) {
                    try {
                        let parsed = null;
                        const cleanInput = (typeof userInput === 'string') ? userInput.replace(/```json/gi, '').replace(/```/g, '').trim() : userInput;
                        try {
                            const jsonMatch = cleanInput.match(/\{[\s\S]*\}/);
                            if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
                            else parsed = JSON.parse(cleanInput);
                        } catch(e) {
                            parsed = { status: 'fail', followUp: `Thank you for your message. Please select one of the available variants for ${productName}: ${variantOptionsList.join(', ')}.` };
                        }

                        if (parsed.status === 'redirect' && parsed.topicId) {
                            this.nodeHistory = [];
                            const entrypoint = this.compiled.entrypoints && this.compiled.entrypoints[parsed.topicId];
                            this.currentNodeId = entrypoint ? entrypoint.id : parsed.topicId;
                            this.status = 'running';
                            await this.step(null);
                            return this.status;
                        }

                        const normalizeStr = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

                        const findMatchingVariant = (valToMatch) => {
                            const normVal = normalizeStr(valToMatch);
                            if (!normVal) return null;
                            return variants.find((v, idx) => {
                                const vName = normalizeStr(v.name || v.label || '');
                                const normIndex = String(idx + 1);
                                return normVal === vName || normVal === normIndex || (vName && (normVal.includes(vName) || vName.includes(normVal)));
                            });
                        };

                        if (parsed.status === 'fail') {
                            const lastUserMsg = (this.nodeHistory && this.nodeHistory.length > 0)
                                ? this.nodeHistory[this.nodeHistory.length - 1].content
                                : cleanInput;
                            const directMatch = findMatchingVariant(lastUserMsg) || findMatchingVariant(cleanInput);
                            if (directMatch) {
                                parsed = { status: 'success', value: directMatch.name || directMatch.label };
                            } else {
                                if (this.onBotMessage && parsed.followUp) {
                                    await this.onBotMessage(parsed.followUp);
                                    if (!this.nodeHistory) this.nodeHistory = [];
                                    this.nodeHistory.push({ role: 'bot', content: parsed.followUp });
                                }
                                this.status = 'waiting_option';
                                return this.status;
                            }
                        }

                        this.nodeHistory = [];
                        const val = parsed.value !== undefined ? parsed.value : userInput;
                        let selectedVariant = findMatchingVariant(val) || variants[0];

                        const varName = currentStep.data.variable;
                        if (varName) {
                            this.variables[varName] = selectedVariant;
                            console.log(`[VariantSelector Node ${currentStep.id}] 💾 Saved selected variant to variable "${varName}":`, JSON.stringify(selectedVariant));
                            this._emitVariables();
                        }

                        this.status = 'running';
                        this._advance(currentStep.next);
                    } catch(e) {
                        console.error(`[VariantSelector Node ${currentStep.id}] ❌ Exception during step execution:`, e);
                        this.status = 'running';
                        this._advance(currentStep.next);
                    }
                } else if (this.status === 'waiting_option' && userInput !== null) {
                    if (this.onAIExtract) {
                        this.status = 'waiting_ai';
                        const defaultAiPrompt = `Select the exact variant of ${productName} the customer wants. Available options: ${variantOptionsList.join(', ')}.`;
                        const aiPrompt = currentStep.data.aiPrompt ? this._interpolate(currentStep.data.aiPrompt) : defaultAiPrompt;
                        const userPrompt = this._interpolate(currentStep.data.prompt || `Which variant of ${productName} would you like?`);

                        if (!this.nodeHistory) this.nodeHistory = [];
                        this.nodeHistory.push({ role: 'user', content: userInput });
                        const currentTopic = this._getCurrentTopicContext();
                        const fullContext = this.nodeHistory.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
                        const entrypoints = this.compiled && this.compiled.entrypoints ? this.compiled.entrypoints : {};
                        const flowTopics = Object.keys(entrypoints).map(k => `- Topic ID: ${k}, Description: ${entrypoints[k].description || 'No description provided'}`).join('\n');

                        this.onAIExtract({
                            userInput: fullContext,
                            userPrompt,
                            aiPrompt,
                            options: variantOptionsList,
                            expectJson: true,
                            flowTopics,
                            currentTopicId: currentTopic.id,
                            currentTopicDescription: currentTopic.description,
                            noAiPrompt: false
                        });
                    } else {
                        const matchedVariant = variants.find(v => {
                            const vName = String(v.name || v.label || '').toLowerCase();
                            return vName.includes(userInput.toLowerCase().trim()) || userInput.toLowerCase().includes(vName);
                        }) || variants[0];

                        const varName = currentStep.data.variable;
                        if (varName) {
                            this.variables[varName] = matchedVariant;
                            this._emitVariables();
                        }

                        this.status = 'running';
                        this._advance(currentStep.next);
                    }
                } else {
                    this.status = 'waiting_option';
                    if (this.onWaitingForOption) {
                        const rawPrompt = currentStep.data.prompt || `Which size/variant would you like for ${productName}?`;
                        const prompt = this._interpolate(rawPrompt).replace(/\{\{productName\}\}/g, productName);
                        await this.onWaitingForOption(prompt, variantOptionsList);
                    }
                }
                break;
            }

            case 'showProductCard': {
                let targetProduct = null;
                const productMode = currentStep.data.productMode || 'dropdown';

                if (productMode === 'variable') {
                    const varName = currentStep.data.productVariable;
                    if (varName && this.variables[varName]) {
                        targetProduct = this.variables[varName];
                    }
                } else {
                    const pId = currentStep.data.productId;
                    if (pId) {
                        try {
                            const aId = localStorage.getItem('activeAccountId');
                            const tok = localStorage.getItem('token');
                            const res = await fetch('/api/catalog', {
                                headers: { 'x-account-id': aId || '', 'x-auth-token': tok || '' }
                            });
                            if (res.ok) {
                                const items = await res.json();
                                targetProduct = items.find(i => (i._id === pId || i.id === pId));
                            }
                        } catch (e) {
                            console.error('[FlowRuntime] Failed to fetch catalog items for showProductCard:', e);
                        }
                    }
                }

                if (!targetProduct) {
                    targetProduct = {
                        fields: {
                            name: 'Product Card',
                            price: 0,
                            description: '',
                            category: '',
                            variants: []
                        },
                        type: 'product',
                        status: 'available'
                    };
                }

                const fields = targetProduct.fields || targetProduct;
                const name = fields.name || targetProduct.name || 'Product';
                const description = fields.description || targetProduct.description || '';
                const category = fields.category || targetProduct.category || '';
                const type = targetProduct.type || 'product';
                const status = targetProduct.status || 'available';
                const imageId = fields.imageId || fields.mediaId || targetProduct.imageId || targetProduct.mediaId || '';
                const variants = Array.isArray(fields.variants) ? fields.variants : (Array.isArray(targetProduct.variants) ? targetProduct.variants : []);

                let priceVal = fields.price !== undefined ? fields.price : targetProduct.price;
                let variantsStr = '';
                if (variants.length > 0) {
                    variantsStr = 'Variants:\n' + variants.map(v => `  • ${v.name}: Rs. ${v.price}`).join('\n');
                    if (priceVal === undefined || priceVal === null || priceVal === '' || priceVal === 'N/A') {
                        const prices = variants.map(v => Number(v.price)).filter(p => !isNaN(p));
                        if (prices.length > 0) {
                            const min = Math.min(...prices);
                            const max = Math.max(...prices);
                            priceVal = min === max ? `${min}` : `${min} - ${max}`;
                        }
                    }
                }
                if (priceVal === undefined || priceVal === null) priceVal = 'N/A';

                let template = currentStep.data.cardTemplate;
                if (!template) {
                    try {
                        const aId = localStorage.getItem('activeAccountId');
                        const tok = localStorage.getItem('token');
                        const res = await fetch('/api/settings', {
                            headers: { 'x-account-id': aId || '', 'x-auth-token': tok || '' }
                        });
                        if (res.ok) {
                            const settings = await res.json();
                            template = settings.itemCardTemplate;
                        }
                    } catch (e) {}
                }

                if (!template) {
                    template = '🏷️ *{{name}}*\n💰 Price: Rs. {{price}}\n\n📝 {{description}}\n\n📦 {{variants}}\n\n_Status: {{status}}_';
                }

                let cardMessage = template
                    .replace(/\{\{name\}\}/g, name)
                    .replace(/\{\{price\}\}/g, priceVal)
                    .replace(/\{\{description\}\}/g, description || '—')
                    .replace(/\{\{category\}\}/g, category || '—')
                    .replace(/\{\{type\}\}/g, type)
                    .replace(/\{\{status\}\}/g, status)
                    .replace(/\{\{imageId\}\}/g, imageId)
                    .replace(/\{\{variants\}\}/g, variantsStr);

                cardMessage = this._interpolate(cardMessage);

                if (this.onBotMessage) {
                    await this.onBotMessage(cardMessage, imageId || null);
                }

                this._advance(currentStep.next);
                break;
            }

            case 'arrayManager':
                const action = currentStep.data.action || 'push';
                const arrVarName = currentStep.data.variable;
                let currentArr = (arrVarName && Array.isArray(this.variables[arrVarName])) ? [...this.variables[arrVarName]] : [];

                if (action === 'clear') {
                    currentArr = [];
                } else if (action === 'push') {
                    // Push the item object from last selected item variable or default structured item
                    const itemToPush = this.variables['selectedItem'] || { itemId: 'ITEM_1', quantity: 1, addedAt: new Date().toISOString() };
                    currentArr.push(itemToPush);
                }

                if (arrVarName) {
                    this.variables[arrVarName] = currentArr;
                    this._emitVariables();
                }
                this._advance(currentStep.next);
                break;

            case 'placeOrder':
                console.log('[PlaceOrder] ▶ Node triggered. Raw step data:', JSON.stringify(currentStep.data || {}));
                console.log('[PlaceOrder] Current variables:', JSON.stringify(this.variables));

                const customFieldsMap = {};
                let mappedItems = [];
                let mappedCustomer = '';

                Object.keys(currentStep.data || {}).forEach(k => {
                    if (k.startsWith('field_')) {
                        const colKey = k.replace('field_', '');
                        const rawVal = currentStep.data[k];
                        const val = this._interpolate(rawVal || '');
                        const varName = rawVal ? rawVal.replace(/[\{\}]/g, '').trim() : '';

                        console.log(`[PlaceOrder] Field "${colKey}": rawVal="${rawVal}", varName="${varName}", resolved="${val}"`);

                        if (colKey === 'items') {
                            mappedItems = (varName && this.variables[varName] !== undefined) ? this.variables[varName] : val;
                            console.log('[PlaceOrder] Mapped items:', JSON.stringify(mappedItems));
                        } else if (colKey === 'customer' || colKey === 'customerName') {
                            mappedCustomer = (varName && this.variables[varName] !== undefined) ? this.variables[varName] : val;
                            console.log('[PlaceOrder] Mapped customer:', mappedCustomer);
                        } else {
                            customFieldsMap[colKey] = (varName && this.variables[varName] !== undefined) ? this.variables[varName] : val;
                        }
                    }
                });

                if (mappedCustomer) customFieldsMap['customerName'] = mappedCustomer;

                let formattedItems = [];
                if (Array.isArray(mappedItems)) {
                    formattedItems = mappedItems;
                } else if (mappedItems) {
                    if (typeof mappedItems === 'object' && mappedItems !== null) {
                        const itemId = mappedItems._id || mappedItems.itemId || null;
                        const snap = mappedItems.fields ? { ...mappedItems.fields, type: mappedItems.type } : mappedItems;
                        formattedItems = [{ itemId, customSnapshot: snap }];
                    } else {
                        formattedItems = [{ customSnapshot: { name: String(mappedItems) } }];
                    }
                }

                const orderData = {
                    orderId: `ORD-${Math.floor(100000 + Math.random() * 900000)}`,
                    customer: mappedCustomer,
                    items: formattedItems,
                    customFields: customFieldsMap,
                    status: 'received',
                    paymentStatus: 'unpaid'
                };

                console.log('[PlaceOrder] Constructed orderData:', JSON.stringify(orderData));

                let savedOrder = null;
                try {
                    if (this.onPlaceOrder) {
                        console.log('[PlaceOrder] Calling onPlaceOrder callback (bot mode)...');
                        savedOrder = await this.onPlaceOrder(orderData);
                        console.log('[PlaceOrder] onPlaceOrder returned:', JSON.stringify(savedOrder));
                    } else {
                        // Fallback in browser simulator: POST /api/orders/public
                        const accountId = (typeof localStorage !== 'undefined') ? localStorage.getItem('activeAccountId') : null;
                        const simToken = (typeof localStorage !== 'undefined') ? localStorage.getItem('token') : null;
                        console.log('[PlaceOrder] Browser mode — accountId:', accountId, '| token present:', !!simToken);

                        if (accountId) {
                            const payload = {
                                orderId: orderData.orderId,
                                customer: orderData.customer,
                                items: orderData.items,
                                customFields: orderData.customFields,
                                status: orderData.status,
                                paymentStatus: orderData.paymentStatus,
                                source: 'flow'
                            };
                            console.log('[PlaceOrder] POST /api/orders/public payload:', JSON.stringify(payload));
                            const res = await fetch('/api/orders/public', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'x-account-id': accountId,
                                    'x-auth-token': simToken || ''
                                },
                                body: JSON.stringify(payload)
                            });
                            const responseText = await res.text();
                            console.log('[PlaceOrder] Response status:', res.status, '| body:', responseText);
                            if (res.ok) {
                                try { savedOrder = JSON.parse(responseText); } catch(e) {}
                                console.log('[PlaceOrder] ✅ Order saved:', JSON.stringify(savedOrder));
                            } else {
                                console.error('[PlaceOrder] ❌ Order API error:', res.status, responseText);
                            }
                        } else {
                            console.error('[PlaceOrder] ❌ No accountId found in localStorage — cannot submit order');
                        }
                    }
                } catch (err) {
                    console.error('[PlaceOrder] ❌ Exception during order submission:', err);
                }

                const finalOrderId = (savedOrder && savedOrder.orderId) ? savedOrder.orderId : orderData.orderId;
                if (this.onBotMessage) {
                    await this.onBotMessage(`🎉 Order Placed Successfully! Your Order ID is: ${finalOrderId}`);
                }
                this.variables['lastOrderId'] = finalOrderId;
                this.variables['lastOrder'] = savedOrder || orderData;
                this._emitVariables();
                this._advance(currentStep.next);
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
        console.log(`[FlowRuntime] ➡️ _advance from '${this.currentNodeId}' to '${nextNodeId}'`);
        if (!nextNodeId) {
            console.log('[FlowRuntime] 🏁 Next node is null/empty. Marking flow as finished.');
            this.status = 'finished';
            if (this.onFlowEnd) this.onFlowEnd();
            return;
        }
        this.currentNodeId = nextNodeId;
        this.stepIndex++;
    }

    /**
     * Helper: safely get nested object property by dot notation path
     */
    _getNestedValue(obj, path) {
        if (obj === undefined || obj === null) return undefined;
        const parts = path.split('.');
        let current = obj;
        for (const part of parts) {
            if (current === undefined || current === null) return undefined;
            current = current[part];
        }
        return current;
    }

    /**
     * Replace {{varName}} or {{varName.path}} placeholders in text with variable values
     */
    _interpolate(text) {
        if (!text || typeof text !== 'string') return text || '';
        return text.replace(/\{\{([\w\.]+)\}\}/g, (match, path) => {
            const parts = path.split('.');
            const rootVar = parts[0];
            let val = this.variables[rootVar];

            if (val === undefined || val === null) {
                return match;
            }

            // If nested path specified like {{selectedItem.fields.name}} or {{selectedItem.name}}
            if (parts.length > 1) {
                const subPath = parts.slice(1).join('.');
                let nested = this._getNestedValue(val, subPath);
                if (nested === undefined && parts[1] !== 'fields' && val.fields) {
                    // Fall back to checking inside fields object (e.g. {{selectedItem.name}} -> val.fields.name)
                    nested = this._getNestedValue(val.fields, subPath);
                }
                return nested !== undefined && nested !== null
                    ? (typeof nested === 'object' ? JSON.stringify(nested) : String(nested))
                    : match;
            }

            // If root variable is referenced directly like {{selectedItem}}
            if (typeof val === 'object' && val !== null) {
                if (val.fields?.name) return val.fields.name;
                if (val.name) return val.name;
                if (val.label) return val.label;
                if (val.title) return val.title;
                if (val.phoneNumber || val.phone) return val.phoneNumber || val.phone;
                return JSON.stringify(val);
            }

            return String(val);
        });
    }

    /**
     * Resolve the current topic ID and description from entrypoints
     */
    _getCurrentTopicContext() {
        if (!this.compiled || !this.compiled.entrypoints) {
            return { id: 'default', description: 'General Conversation' };
        }
        const entrypoints = this.compiled.entrypoints;
        for (const [topicId, info] of Object.entries(entrypoints)) {
            if (info && info.id === this.currentNodeId) {
                return { id: topicId, description: info.description || 'No description provided' };
            }
        }
        // Fallback: use first entrypoint or default
        const firstKey = Object.keys(entrypoints)[0];
        if (firstKey && entrypoints[firstKey]) {
            return { id: firstKey, description: entrypoints[firstKey].description || 'No description provided' };
        }
        return { id: 'default', description: 'General Flow Context' };
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

// Export for browser and Node
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FlowRuntime;
} else {
    window.FlowRuntime = FlowRuntime;
}
