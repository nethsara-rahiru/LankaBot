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

        // Callbacks (set by Simulator or Server)
        this.onBotMessage = null;
        this.onWaitingForInput = null;
        this.onWaitingForOption = null;
        this.onWait = null;
        this.onStepChange = null;
        this.onVariableUpdate = null;
        this.onFlowEnd = null;
        this.onAIExtract = null;
        this.onShowCatalog = null; // async (itemType) => { items: [...], menuStyle: {...} }
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

            case 'get':
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
                                if (!this.nodeHistory) this.nodeHistory = [];
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
                try {
                    let items = [];
                    let menuStyle = {
                        header: '🛍️ *OUR CATALOG*',
                        itemFormat: '• *{{name}}*\n  Price: Rs. {{price}}\n  _{{category}}_',
                        footer: 'Type item name to order!'
                    };

                    if (this.onShowCatalog) {
                        // Server-side: delegate entirely to the injected callback (DB query)
                        const result = await this.onShowCatalog(showCatType);
                        if (result) {
                            items = result.items || [];
                            if (result.menuStyle) menuStyle = result.menuStyle;
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
                            if (sett.menuStyle) menuStyle = sett.menuStyle;
                        }
                    }

                    const applyVars = (template, item) => {
                        if (!template) return '';
                        return template
                            .replace(/\{\{name\}\}/g, item.fields?.name || '')
                            .replace(/\{\{price\}\}/g, item.fields?.price !== undefined ? item.fields.price : 'N/A')
                            .replace(/\{\{category\}\}/g, item.fields?.category || '')
                            .replace(/\{\{type\}\}/g, item.type || '')
                            .replace(/\{\{status\}\}/g, item.status || 'available');
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

                const optionsList = catalogItems.map(item => {
                    const name = item.fields?.name || item.name || 'Unnamed Item';
                    const price = item.fields?.price !== undefined ? item.fields.price : (item.price || 'N/A');
                    const category = item.fields?.category || item.category || '';
                    return `${name} (Rs. ${price}${category ? ', ' + category : ''})`;
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
                            this.status = 'waiting_option';
                            return this.status;
                        }

                        this.nodeHistory = [];
                        const val = parsed.value !== undefined ? parsed.value : userInput;

                        // Match selected item name back to the full catalog item object
                        let selectedItem = catalogItems.find(item => {
                            const itemName = item.fields?.name || item.name || '';
                            return itemName.toLowerCase().trim() === String(val).toLowerCase().trim() ||
                                   String(val).toLowerCase().includes(itemName.toLowerCase().trim());
                        }) || catalogItems[0];

                        const varName = currentStep.data.variable;
                        if (varName) {
                            this.variables[varName] = selectedItem;
                            this._emitVariables();
                        }

                        this.status = 'running';
                        this._advance(currentStep.next);
                    } catch(e) {
                        this.status = 'running';
                        this._advance(currentStep.next);
                    }
                } else if (this.status === 'waiting_option' && userInput !== null) {
                    if (this.onAIExtract) {
                        this.status = 'waiting_ai';
                        const aiPrompt = currentStep.data.aiPrompt || 'Select the exact catalog item the customer wants. If the customer request is ambiguous or vague, ask clarifying follow-up questions to identify the correct item.';
                        const interpolatedAiPrompt = this._interpolate(aiPrompt);
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
                        // Match user input directly
                        let selectedItem = catalogItems.find(item => {
                            const itemName = item.fields?.name || item.name || '';
                            return itemName.toLowerCase().includes(userInput.toLowerCase().trim()) ||
                                   userInput.toLowerCase().includes(itemName.toLowerCase().trim());
                        }) || catalogItems[0];

                        const varName = currentStep.data.variable;
                        if (varName) {
                            this.variables[varName] = selectedItem;
                            this._emitVariables();
                        }
                        this.status = 'running';
                        this._advance(currentStep.next);
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
                const cartVarName = currentStep.data.variable;
                const cartData = cartVarName ? (this.variables[cartVarName] || []) : [];
                const mockOrderId = `ORD-${Math.floor(100000 + Math.random() * 900000)}`;

                if (this.onBotMessage) {
                    await this.onBotMessage(`🎉 Order Placed Successfully! Your Order ID is: ${mockOrderId}`);
                }
                this.variables['lastOrderId'] = mockOrderId;
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
