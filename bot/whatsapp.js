const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const sessionManager = require('./sessionManager');
const Rule = require('../models/Rule');
const Settings = require('../models/Settings');
const Account = require('../models/Account');
const Customer = require('../models/Customer');
const OrganizationContact = require('../models/OrganizationContact');
const Message = require('../models/Message');
const AILog = require('../models/AILog');
const { getAIResponse, buildExtractionPrompt } = require('../services/api-router/apiRouterService');
const { detectAndSaveLanguage, processOutgoingMessage, translateIncomingToEnglish } = require('../services/languageService');
const { queueCustomerAnalysis } = require('../controllers/customerController');
const qrcodeImage = require('qrcode');
const FlowRuntime = require('../public/FlowManager/Runtime/runtime');
const Resource = require('../models/Resource');
const fs = require('fs');
const path = require('path');

let ioInstance;
const clients = new Map(); // accountId -> Client instance
const aiBuffers = new Map(); // userId_accountId -> { messages: [], timeout: null }
const sheetCache = new Map(); // accountId -> { data: string, fetchedAt: number }
const activeFlows = new Map(); // orgContactId -> FlowRuntime

// Fetches CSV from a Google Sheet URL with 60-second cache
const fetchSheetData = async (accountId, url) => {
    if (!url || !url.startsWith('http')) return null;
    const cached = sheetCache.get(accountId);
    if (cached && (Date.now() - cached.fetchedAt) < 60000) {
        return cached.data;
    }
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const csv = await res.text();
        sheetCache.set(accountId, { data: csv, fetchedAt: Date.now() });
        console.log(`[WhatsApp ${accountId}] 📊 Successfully fetched live Google Sheet data`);
        return csv;
    } catch (e) {
        console.error(`[WhatsApp ${accountId}] ❌ Error fetching Google Sheet:`, e.message);
        return null;
    }
};

// Initialize the manager with Socket.io
const init = async (io) => {
    ioInstance = io;
    console.log('[WhatsApp Manager] ✅ Initialized and connected to Socket.io');

    // Load all active accounts from DB and start them
    try {
        const accounts = await Account.find();
        console.log(`[WhatsApp Manager] 📂 Found ${accounts.length} account(s) in database. Attempting to start clients...`);
        for (const account of accounts) {
            startClient(account._id);
        }
    } catch (err) {
        console.error('[WhatsApp Manager] ❌ Error loading accounts from DB:', err.message);
    }

    // Global Socket Events
    io.on('connection', (socket) => {
        socket.on('get_status', async (accountId) => {
            const client = clients.get(accountId.toString());
            if (client) {
                const account = await Account.findById(accountId);
                socket.emit('account_status', {
                    accountId,
                    status: account.status,
                    accountInfo: {
                        name: account.pushName,
                        number: account.phoneNumber,
                        profilePic: account.profilePic
                    },
                    lastQR: account.lastQR
                });
            }
        });

        socket.on('logout_account', async (accountId) => {
            console.log(`[WhatsApp ${accountId}] 🔌 Logout requested via Socket`);
            const client = clients.get(accountId.toString());
            if (client) {
                try {
                    await client.logout();
                    console.log(`[WhatsApp ${accountId}] ✅ Successfully logged out`);
                } catch (err) {
                    console.error(`[WhatsApp ${accountId}] ❌ Logout error:`, err.message);
                }
            }
        });

        socket.on('send_message', async (data, callback) => {
            try {
                const { accountId, phone, message } = data;
                const client = clients.get(accountId.toString());
                if (!client) {
                    console.warn(`[WhatsApp ${accountId}] ⚠️ Failed to send socket message: Client not found`);
                    return callback({ success: false, error: 'Client not found' });
                }

                const number = phone.includes('@c.us') ? phone : `${phone}@c.us`;
                await client.sendMessage(number, message);
                console.log(`[WhatsApp ${accountId}] 📤 Socket message sent to ${number}`);
                callback({ success: true });
            } catch (err) {
                console.error(`[WhatsApp ${data.accountId}] ❌ Socket send_message error:`, err.message);
                callback({ success: false, error: err.message });
            }
        });
    });
};

const startClient = async (accountId) => {
    accountId = accountId.toString();
    if (clients.has(accountId)) {
        console.log(`[WhatsApp Manager] ⚠️ Client already running for account ${accountId}, skipping.`);
        return;
    }

    const account = await Account.findById(accountId);
    if (!account) {
        console.error(`[WhatsApp Manager] ❌ Account not found in DB for ID: ${accountId}`);
        return;
    }

    console.log(`[WhatsApp ${account.sessionId}] 🚀 Starting WhatsApp Client initialization...`);

    let client;
    try {
        client = await sessionManager.createClientSession(account, ioInstance);
    } catch (error) {
        console.error(`[WhatsApp ${account.sessionId}] ❌ Error instantiating client:`, error.message);
        await Account.findByIdAndUpdate(accountId, { status: 'disconnected' });
        return;
    }

    clients.set(accountId, client);

    client.on('message_create', async (msg) => {
        // Only process incoming messages (not ones sent by the bot itself)
        if (msg.fromMe) return;

        // Ignore system messages, stickers, and empty bodies
        const ignoredTypes = ['sticker', 'e2e_notification', 'protocol', 'gp2', 'call_log'];
        if (ignoredTypes.includes(msg.type) || msg.from === 'status@broadcast' || !msg.body) {
            return;
        }

        console.log(`[WhatsApp ${account.sessionId}] 📩 Message received from ${msg.from}: "${(msg.body || '').substring(0, 50)}"`);

        // Check if account is paused
        const accountData = await Account.findById(accountId);
        if (accountData && accountData.paused) {
            console.log(`[WhatsApp ${account.sessionId}] ⏸️ Account is paused, ignoring message from ${msg.from}`);
            return;
        }

        const user = msg.from.split('@')[0];
        ioInstance.emit('message_log', { accountId, from: user, body: msg.body });

        try {
            const pushName = (await msg.getContact()).pushname || '';

            // 1. Find or create Global Customer
            let customer = await Customer.findOne({ phoneNumber: user });
            if (!customer) {
                customer = new Customer({ phoneNumber: user, name: pushName });
                await customer.save();
                console.log(`[WhatsApp ${account.sessionId}] 🆕 Created new Global Customer: ${user}`);
            } else if (!customer.name && pushName) {
                customer.name = pushName;
                await customer.save();
            }

            // Detect and save language preference on every incoming message
            try {
                await detectAndSaveLanguage(customer, msg.body);
            } catch (e) {
                console.error(`[WhatsApp ${account.sessionId}] Language detection error:`, e.message);
            }

            // 2. Find or create OrganizationContact
            let orgContact = await OrganizationContact.findOne({ account: accountId, customer: customer._id });
            if (!orgContact) {
                orgContact = new OrganizationContact({ account: accountId, customer: customer._id });
                await orgContact.save();
                console.log(`[WhatsApp ${account.sessionId}] 🏢 Created new OrganizationContact for ${user}`);
            } else {
                orgContact.lastMessageAt = new Date();
                await orgContact.save();
            }

            // Detect and fetch quoted/replied message if present
            let quotedMessageData = null;
            if (msg.hasQuotedMsg) {
                try {
                    const quotedMsg = await msg.getQuotedMessage();
                    if (quotedMsg && quotedMsg.body) {
                        quotedMessageData = {
                            content: quotedMsg.body,
                            role: quotedMsg.fromMe ? 'bot' : 'user'
                        };
                        console.log(`[WhatsApp ${account.sessionId}] 💬 Quoted message detected (${quotedMessageData.role}): "${quotedMsg.body.substring(0, 60)}"`);
                    }
                } catch (e) {
                    console.warn(`[WhatsApp ${account.sessionId}] ⚠️ Error fetching quoted message:`, e.message);
                }
            }

            const effectiveInput = quotedMessageData && quotedMessageData.content
                ? `[Replying to message: "${quotedMessageData.content}"]\n${msg.body}`
                : msg.body;

            msg.effectiveInput = effectiveInput;
            msg.quotedMessageData = quotedMessageData;

            // 3. Save Message
            const newMsg = new Message({
                organizationContact: orgContact._id,
                role: 'user',
                content: msg.body,
                messageType: msg.type || 'text',
                quotedMessage: quotedMessageData || undefined
            });
            await newMsg.save();

            // Emit real-time message for audience insights chatbox
            ioInstance.emit('new_message', {
                accountId,
                orgContactId: orgContact._id.toString(),
                message: {
                    _id: newMsg._id,
                    role: newMsg.role,
                    content: newMsg.content,
                    messageType: newMsg.messageType,
                    timestamp: newMsg.timestamp
                }
            });

            // Note: attach orgContact._id to msg object for later use
            msg.orgContactId = orgContact._id;
            msg.customerId = customer._id;

        } catch (e) {
            console.error(`[WhatsApp ${account.sessionId}] ❌ Customer/Message logging error:`, e.message);
        }

        try {
            // Find Rules for THIS account, sorted by priority (1 is highest priority)
            const rules = await Rule.find({ account: accountId, active: true }).sort({ priority: 1 });
            const matchedRule = rules.find(r => {
                const body = (msg.body || '').toLowerCase();
                const trigger = r.trigger.toLowerCase();

                switch (r.matchType) {
                    case 'exact': return body === trigger;
                    case 'startsWith': return body.startsWith(trigger);
                    case 'endsWith': return body.endsWith(trigger);
                    case 'fuzzy':
                        const triggerWords = trigger.split(/\s+/);
                        return triggerWords.every(word => body.includes(word)) || body.includes(trigger);
                    case 'regex':
                        try { return new RegExp(r.trigger, 'i').test(msg.body); } catch (e) { return false; }
                    case 'contains':
                    default: return body.includes(trigger);
                }
            });

            if (matchedRule) {
                console.log(`[WhatsApp ${account.sessionId}] ⚡ Rule matched! Trigger: "${matchedRule.trigger}". Processing reply...`);
                const settings = await Settings.findOne({ account: accountId });
                const customer = await Customer.findOne({ phoneNumber: user });
                const finalReply = await processOutgoingMessage(matchedRule.reply, customer, settings);

                await msg.reply(finalReply);
                ioInstance.emit('system_log', `[Account ${account.sessionId}] Auto-replied to ${user} via Rule`);

                try {
                    if (msg.orgContactId) {
                        const botMsg = new Message({
                            organizationContact: msg.orgContactId,
                            role: 'bot',
                            content: finalReply,
                            messageType: 'text'
                        });
                        await botMsg.save();
                        ioInstance.emit('new_message', {
                            accountId,
                            orgContactId: msg.orgContactId.toString(),
                            message: { _id: botMsg._id, role: 'bot', content: finalReply, messageType: 'text', timestamp: botMsg.timestamp }
                        });
                    }
                } catch (e) {
                    console.error(`[WhatsApp ${account.sessionId}] ❌ Error saving Rule reply to DB:`, e.message);
                }
                return; // Stop processing further if a rule was matched
            }

            // Flow Reply Mode
            const settings = await Settings.findOne({ account: accountId });

            if (settings && settings.replyMethod === 'flow' && settings.compiledFlow) {
                const orgId = msg.orgContactId.toString();
                let flow = activeFlows.get(orgId);
                let isNewFlowInstance = false;

                // 1. Initialize or Restore Flow State BEFORE routing
                if (!flow) {
                    isNewFlowInstance = true;
                    flow = new FlowRuntime();
                    try {
                        const orgContact = await OrganizationContact.findById(msg.orgContactId);
                        if (orgContact && orgContact.flowState && orgContact.flowState.status !== 'idle' && orgContact.flowState.currentNodeId) {
                            flow.compiled = settings.compiledFlow;
                            flow.variables = orgContact.flowState.variables || {};
                            flow.status = orgContact.flowState.status;
                            flow.currentNodeId = orgContact.flowState.currentNodeId;
                            flow.nodeHistory = orgContact.flowState.nodeHistory || [];
                            // Restore interruption stack so side-question context is preserved across reconnects
                            flow._interruptionStack = orgContact.flowState.interruptionStack || [];
                        } else {
                            flow.start(settings.compiledFlow);
                        }
                    } catch (err) {
                        flow.start(settings.compiledFlow);
                    }
                }

                // 2. GLOBAL AI ROUTING
                const entrypoints = settings.compiledFlow.entrypoints || {};
                const entryKeys = Object.keys(entrypoints);
                let shouldRedirect = null;

                if (entryKeys.length > 0) {
                    const topics = entryKeys.map(k => `- Topic ID: ${k}, Description: ${entrypoints[k].description || 'No description'}`).join('\n');
                    let currentContext = 'The user is starting a NEW conversation. There is no active flow.';
                    if (flow && flow.status !== 'idle') {
                        const currentTopic = flow._getCurrentTopicContext ? flow._getCurrentTopicContext() : { id: 'active', description: 'Active conversation flow' };
                        currentContext = `The user is currently in an ACTIVE flow.
Current Topic ID: ${currentTopic.id}
Current Topic Description: ${currentTopic.description}
You MUST assume their message is a response to the ongoing flow (output "continue"), UNLESS they are explicitly demanding to change the subject to one of the available flows.`;
                    }

                    const routerInput = msg.effectiveInput || msg.body;
                    const routerPrompt = `You are a conversational router AI for a WhatsApp bot.
The user sent a new message: "${routerInput}"

CONTEXT:
${currentContext}

Available flows:
${topics}

MULTILINGUAL AWARENESS:
The user may write in any language or transliteration style. You MUST understand their intent regardless of script or language:
- Singlish (Sinhala written in English letters, e.g. "mage bill eka" = "my bill", "mama ganna" = "I want to take/get", "kohomada" = "how is", "api" = "we/us")
- Native Sinhala script (e.g. "මගේ බිල්", "ගෙවීම")
- Romanized Tamil (e.g. "en bill", "vanakkam", "enna" = "what")
- Native Tamil script (e.g. "என் பில்")
- Mixed English + Sinhala or Tamil words
Mentally translate the user's intent to English and match it against the available flow descriptions.

REPLY MESSAGES:
If the user's message starts with [Replying to message: "..."], the user is replying to a previous bot message. This is almost ALWAYS a continuation of the current flow (output "continue"), not a topic change. Only redirect if the reply text itself explicitly demands a completely different topic.

Based on the user's message, decide if they are trying to start or switch to one of the available flows.
If the message is a normal continuation of the current conversation and does NOT indicate a deliberate topic change, output "continue".
If the message clearly matches one of the flow descriptions (even in another language), output the EXACT Topic ID.
Output ONLY "continue" or the Topic ID. Nothing else.`;

                    try {
                        const routeRes = (await getAIResponse(routerInput, routerPrompt, 1)) || 'continue';
                        const decidedRoute = routeRes.trim();
                        if (decidedRoute !== 'continue' && entrypoints[decidedRoute]) {
                            shouldRedirect = entrypoints[decidedRoute].id;
                        } else if (flow.status === 'idle' && entrypoints['default']) {
                            shouldRedirect = entrypoints['default'].id;
                        }
                    } catch (e) {
                        console.error('Router error', e);
                    }
                }

                // 3. Bind Callbacks if it's a new instance
                if (isNewFlowInstance) {

                    // ─── Conversation Engine (new) ─────────────────────────────────────────
                    flow.onConversationEngine = async (flowInstance, userInput) => {
                        try {
                            const currentSettings = await Settings.findOne({ account: accountId });
                            const currentStep = flowInstance.compiled?.steps?.find(s => s.id === flowInstance.currentNodeId);

                            // ⚡ Fast-path exact keyword check for getOption nodes (bypass translation & AI)
                            if (currentStep && currentStep.type === 'getOption') {
                                const wordLists = currentSettings?.wordLists || [];
                                flowInstance.wordLists = wordLists;
                                const fastMatch = flowInstance._fastMatchOption(userInput, currentStep.options, wordLists);
                                if (fastMatch) {
                                    console.log(`[WhatsApp CE] ⚡ Fast-path exact keyword match: "${userInput}" → option "${fastMatch.value}" (Next: "${fastMatch.next}"). Bypassing translation & AI.`);
                                    const varName = currentStep.data?.variable;
                                    if (varName) {
                                        flowInstance.variables[varName] = fastMatch.value;
                                        flowInstance._emitVariables();
                                    }
                                    flowInstance.status = 'running';
                                    flowInstance._advance(fastMatch.next);
                                    await flow.resume();
                                    return;
                                }
                            }

                            const { processMessage } = require('../services/conversation/conversationService');
                            const currentCustomer = await Customer.findOne({ phoneNumber: user });
                            const business = {
                                name: currentSettings?.aiConfig?.organizationName || account?.pushName || 'FrontDesk',
                                description: currentSettings?.aiConfig?.aiPersonality || null,
                                settings: currentSettings || {},
                                customer: currentCustomer || null
                            };

                            // Run Conversation Engine pipeline
                            const result = await processMessage(flowInstance, userInput, business, []);

                            console.log(`[WhatsApp CE] 🧠 CE result: nodeSatisfied=${result.nodeSatisfied} | topicChanged=${result.topicChanged} | continueFlow=${result.shouldContinueFlow}`);

                            // Send the generated response to the user
                            if (result.response && flow.onBotMessage) {
                                await flow.onBotMessage(result.response);
                            }

                            // Signal the runtime how to advance
                            if (result.isGreeting || result.flowRestarted) {
                                console.log('[WhatsApp CE] 👋 Greeting detected. Flow restarted from start.');
                                flowInstance.variables = {};
                                flowInstance.start(settings.compiledFlow);
                                flowInstance.status = 'running';
                            } else if (result.isRefusal) {
                                // User refused to answer; release node lock and set flow to idle
                                console.log('[WhatsApp CE] ✋ User refusal detected. Flow reset to idle.');
                                flowInstance.status = 'idle';
                            } else if (result.topicChanged) {
                                // Topic switch was already applied by actionService.switchTopic()
                                // Just resume the flow from the new node
                                flowInstance.status = 'running';
                            } else if (result.nodeSatisfied) {
                                await flowInstance.step('__ce_satisfied__');
                            } else {
                                await flowInstance.step('__ce_pending__');
                            }

                            await flow.resume();

                        } catch (err) {
                            console.error('[WhatsApp CE] ❌ Conversation Engine error, falling back to raw input:', err.message);
                            // Graceful degradation: treat user input as raw variable value
                            const currentStep = flowInstance.compiled?.steps?.find(s => s.id === flowInstance.currentNodeId);
                            const varName = currentStep?.data?.variable;
                            if (varName) {
                                flowInstance.variables[varName] = userInput;
                                flowInstance._emitVariables();
                            }
                            flowInstance.status = 'running';
                            await flowInstance.step('__ce_satisfied__');
                            await flow.resume();
                        }
                    };
                    // ──────────────────────────────────────────────────────────────────────

                    flow.resume = async (initialInput = null) => {
                        console.log(`[WhatsApp Flow] 🔄 flow.resume() called. Current status: '${flow.status}', isRunning: ${flow._isRunning}, currentNode: '${flow.currentNodeId}'`);
                        if (flow._isRunning) {
                            console.log('[WhatsApp Flow] ⚠️ flow.resume() already running, skipping re-entry.');
                            return;
                        }
                        flow._isRunning = true;
                        let pendingInput = initialInput;
                        while (flow.status === 'running') {
                            console.log(`[WhatsApp Flow] ⚡ flow.resume loop stepping node '${flow.currentNodeId}'...`);
                            const inputToPass = pendingInput;
                            await flow.step(inputToPass);
                            pendingInput = null;
                            await new Promise(r => setTimeout(r, 10)); // minimal delay to ensure order
                        }
                        console.log(`[WhatsApp Flow] ⏸️ flow.resume loop stopped. Final status: '${flow.status}', currentNode: '${flow.currentNodeId}'`);
                        flow._isRunning = false;
                    };

                    flow.onBotMessage = async (text, mediaId) => {
                        const currentCustomer = await Customer.findOne({ phoneNumber: user });
                        const translatedText = text ? await processOutgoingMessage(text, currentCustomer, settings) : text;

                        const isTypingEnabled = settings?.sendTyping !== false;
                        if (isTypingEnabled) {
                            const wordCount = (translatedText || '').split(/\s+/).filter(w => w.length > 0).length;
                            const maxTyping = (settings?.typingTime !== undefined && settings.typingTime !== null) ? settings.typingTime : 3000;
                            const typingMs = Math.min(wordCount * 400, maxTyping);
                            if (typingMs > 0) {
                                try {
                                    const chat = await msg.getChat();
                                    if (chat.sendPresence) await chat.sendPresence('composing');
                                    else if (chat.sendStateTyping) await chat.sendStateTyping();
                                } catch (e) { }
                                await new Promise(r => setTimeout(r, typingMs));
                            }
                        }

                        let mediaContent = null;
                        if (mediaId) {
                            try {
                                const accountData = await Account.findById(accountId);
                                const resource = await Resource.findOne({ _id: mediaId, ownerId: accountData.user });
                                if (resource) {
                                    const filePath = path.join(__dirname, '..', 'assets', accountData.user.toString(), resource.storedName);
                                    if (fs.existsSync(filePath)) {
                                        mediaContent = MessageMedia.fromFilePath(filePath);
                                    }
                                }
                            } catch (e) {
                                console.error('Error fetching media for flow reply:', e);
                            }
                        }

                        if (mediaContent) {
                            await msg.reply(mediaContent, undefined, { caption: translatedText || undefined });
                        } else {
                            await msg.reply(translatedText);
                        }

                        try {
                            const botMsg = new Message({
                                organizationContact: msg.orgContactId,
                                role: 'bot',
                                content: translatedText || (mediaContent ? '[Media Message]' : ''),
                                messageType: mediaContent ? 'image' : 'text'
                            });
                            await botMsg.save();
                            ioInstance.emit('new_message', {
                                accountId,
                                orgContactId: msg.orgContactId.toString(),
                                message: { _id: botMsg._id, role: 'bot', content: translatedText, messageType: 'text', timestamp: botMsg.timestamp }
                            });
                        } catch (e) {
                            console.error('Error saving Flow bot message to DB:', e);
                        }
                    };

                    flow.onWaitingForInput = async (prompt) => {
                        const currentCustomer = await Customer.findOne({ phoneNumber: user });
                        const translatedPrompt = await processOutgoingMessage(prompt, currentCustomer, settings);

                        await msg.reply(translatedPrompt);
                        try {
                            const botMsg = new Message({
                                organizationContact: msg.orgContactId,
                                role: 'bot',
                                content: translatedPrompt,
                                messageType: 'text'
                            });
                            await botMsg.save();
                            ioInstance.emit('new_message', {
                                accountId,
                                orgContactId: msg.orgContactId.toString(),
                                message: { _id: botMsg._id, role: 'bot', content: translatedPrompt, messageType: 'text', timestamp: botMsg.timestamp }
                            });
                        } catch (e) {
                            console.error('Error saving Flow input prompt to DB:', e);
                        }
                    };

                    flow.onWaitingForOption = async (prompt, options, nodeType) => {
                        const currentCustomer = await Customer.findOne({ phoneNumber: user });
                        
                        let fullMessageText = prompt;
                        if (nodeType === 'variantSelector' && Array.isArray(options) && options.length > 0) {
                            const formattedOptions = options.map((opt) => `• ${opt}`).join('\n');
                            fullMessageText = `${prompt}\n\n${formattedOptions}`;
                        }

                        const translatedPrompt = await processOutgoingMessage(fullMessageText, currentCustomer, settings);

                        await msg.reply(translatedPrompt);
                        try {
                            const botMsg = new Message({
                                organizationContact: msg.orgContactId,
                                role: 'bot',
                                content: translatedPrompt,
                                messageType: 'text'
                            });
                            await botMsg.save();
                            ioInstance.emit('new_message', {
                                accountId,
                                orgContactId: msg.orgContactId.toString(),
                                message: { _id: botMsg._id, role: 'bot', content: translatedPrompt, messageType: 'text', timestamp: botMsg.timestamp }
                            });
                        } catch (e) {
                            console.error('Error saving Flow option prompt to DB:', e);
                        }
                    };

                    flow.onWait = (seconds) => {
                        setTimeout(() => {
                            setTimeout(() => flow.resume(), 50); // Resume after runtime's internal timer
                        }, seconds * 1000);
                    };

                    flow.onAIExtract = async (data) => {
                        // Skip pre-translation for CatalogSelector node — feed raw user input directly to AI so it matches Sinhala/Singlish item names natively
                        if (data.nodeType !== 'catalogSelector') {
                            try {
                                const currentCustForTranslation = await Customer.findOne({ phoneNumber: user });
                                if (currentCustForTranslation) {
                                    const { translatedText, wasTranslated } = await translateIncomingToEnglish(data.userInput, currentCustForTranslation);
                                    if (wasTranslated) {
                                        console.log(`[Flow AIExtract] 🌐 User input translated to English for AI processing.`);
                                        data = { ...data, userInput: translatedText };
                                    }
                                }
                            } catch (e) {
                                console.error('[Flow AIExtract] ⚠️ Translation pre-processing failed, using original input:', e.message);
                            }
                        } else {
                            console.log(`[Flow AIExtract] ⏩ Skipping Luma translation for CatalogSelector node. Feeding raw user input directly to AI.`);
                        }

                        const systemPrompt = buildExtractionPrompt(data);

                        console.log(`[Flow AIExtract] 🧠 AI Extract initiated for user input context length: ${data.userInput ? data.userInput.length : 0}`);
                        let rawRes = null;
                        try {
                            rawRes = await getAIResponse(data.userInput, systemPrompt, 1);
                            console.log(`[Flow AIExtract] 🤖 Raw AI Response: "${rawRes}"`);
                        } catch (e) {
                            console.error('[Flow AIExtract] ❌ Error fetching AI response:', e);
                            rawRes = null;
                        }

                        // Parse preferredLanguage from AI response and persist it
                        if (rawRes) {
                            const cleanedRes = typeof rawRes === 'string'
                                ? rawRes.replace(/```json/gi, '').replace(/```/g, '').trim()
                                : rawRes;

                            try {
                                const parsed = typeof cleanedRes === 'string' ? JSON.parse(cleanedRes) : cleanedRes;
                                const detectedLang = parsed.preferredLanguage;
                                if (detectedLang && typeof detectedLang === 'string' && detectedLang.trim()) {
                                    const currentCust = await Customer.findOne({ phoneNumber: user });
                                    if (currentCust) {
                                        const langName = detectedLang.trim();
                                        await Customer.findByIdAndUpdate(currentCust._id, {
                                            $set: { 'globalProfile.preferredLanguage': langName }
                                        });
                                        console.log(`[Flow AIExtract] 🌐 Language detected & saved: "${langName}" for ${user}`);
                                    }
                                }
                            } catch (e) {
                                console.error('[Flow AIExtract] Language parse error:', e.message);
                            }
                            console.log('[Flow AIExtract] 📥 Stepping flow with AI response JSON...');
                            await flow.step(cleanedRes);
                        } else {
                            console.log('[Flow AIExtract] ⚠️ AI returned null, stepping flow with raw user input...');
                            await flow.step(data.userInput);
                        }
                        console.log('[Flow AIExtract] 🔄 Resuming flow after AI step...');
                        await flow.resume();
                    };

                    flow.onShowCatalog = async (showCatType, styleName) => {
                        try {
                            const CatalogItem = require('../models/CatalogItem');
                            const filter = { account: accountId };
                            if (showCatType) filter.type = showCatType;

                            const items = await CatalogItem.find(filter);
                            const currentSettings = await Settings.findOne({ account: accountId });

                            return {
                                items: items || [],
                                menuStyle: currentSettings?.menuStyle || null,
                                menuStyles: currentSettings?.menuStyles || []
                            };
                        } catch (err) {
                            console.error('[WhatsApp Flow] Error fetching catalog items for flow:', err);
                            return { items: [], menuStyle: null, menuStyles: [] };
                        }
                    };

                    flow.onPlaceOrder = async (orderData) => {
                        try {
                            const orderService = require('../services/orders/orderService');
                            const formattedItems = Array.isArray(orderData.items) ? orderData.items : [{ customSnapshot: { name: orderData.items } }];

                            const saved = await orderService.createOrder(accountId, {
                                organizationContactId: msg.orgContactId,
                                customerId: msg.customerId,
                                items: formattedItems,
                                customFields: orderData.customFields || {},
                                status: 'received',
                                source: 'flow'
                            });
                            console.log(`[WhatsApp Flow] ✅ Order created in database: ${saved.orderId}`);
                            return saved;
                        } catch (err) {
                            console.error('[WhatsApp Flow] ❌ Error creating order in DB:', err);
                            return null;
                        }
                    };

                    flow.onSendMessage = async (phone, text, mediaId) => {
                        if (!phone) {
                            console.warn('[WhatsApp Flow] ⚠️ Send Message node skipped: No phone number provided');
                            return;
                        }
                        try {
                            const currentCustomer = await Customer.findOne({ phoneNumber: user });
                            const translatedText = text ? await processOutgoingMessage(text, currentCustomer, settings) : text;

                            let cleanPhone = String(phone).replace(/[^0-9]/g, '');
                            if (cleanPhone.startsWith('0') && cleanPhone.length === 10) {
                                cleanPhone = '94' + cleanPhone.slice(1);
                            }
                            if (!cleanPhone) {
                                console.warn(`[WhatsApp Flow] ⚠️ Send Message node: Invalid phone number input "${phone}"`);
                                return;
                            }
                            const formattedNumber = `${cleanPhone}@c.us`;

                            let mediaContent = null;
                            if (mediaId) {
                                try {
                                    const accountData = await Account.findById(accountId);
                                    const resource = await Resource.findOne({ _id: mediaId, ownerId: accountData.user });
                                    if (resource) {
                                        const filePath = path.join(__dirname, '..', 'assets', accountData.user.toString(), resource.storedName);
                                        if (fs.existsSync(filePath)) {
                                            mediaContent = MessageMedia.fromFilePath(filePath);
                                        }
                                    }
                                } catch (e) {
                                    console.error('[WhatsApp Flow] Error fetching media for Send Message node:', e.message || e);
                                }
                            }

                            const client = clients.get(accountId.toString());
                            if (client) {
                                if (mediaContent) {
                                    await client.sendMessage(formattedNumber, mediaContent, { caption: translatedText || undefined });
                                } else if (translatedText) {
                                    await client.sendMessage(formattedNumber, translatedText);
                                }
                                console.log(`[WhatsApp Flow] 📤 Sent message to target number ${formattedNumber}`);
                            } else {
                                console.warn(`[WhatsApp Flow] ⚠️ Client not ready for account ${accountId}`);
                            }
                        } catch (err) {
                            console.error('[WhatsApp Flow] ❌ Error executing Send Message node:', err && err.stack ? err.stack : err);
                        }
                    };

                    flow.onVariableUpdate = async (vars) => {
                        try {
                            await OrganizationContact.findByIdAndUpdate(msg.orgContactId, {
                                'flowState.variables': vars
                            });
                            console.log(`[WhatsApp Flow] 💾 Variables updated and persisted for orgContact ${orgId}`);
                        } catch (e) { }
                    };

                    flow.onStepChange = async () => {
                        try {
                            await OrganizationContact.findByIdAndUpdate(msg.orgContactId, {
                                flowState: {
                                    currentNodeId: flow.currentNodeId,
                                    variables: flow.variables,
                                    status: flow.status,
                                    // Persist interruption stack so conversation resumes correctly
                                    // even after a multi-session WhatsApp reconnect.
                                    nodeHistory: flow.nodeHistory || [],
                                    interruptionStack: flow._interruptionStack || []
                                }
                            });
                        } catch (e) { }
                    };

                    flow.onFlowEnd = async () => {
                        activeFlows.delete(orgId);
                        try {
                            await OrganizationContact.findByIdAndUpdate(msg.orgContactId, {
                                flowState: { currentNodeId: null, variables: {}, status: 'idle' }
                            });
                        } catch (e) { }
                    };

                    activeFlows.set(orgId, flow);
                }

                if (shouldRedirect) {
                    console.log(`[WhatsApp Flow] 🔀 Redirecting flow to topic entrypoint node '${shouldRedirect}'`);
                    flow.variables = {};
                    flow.status = 'idle';
                    flow.start(settings.compiledFlow);
                    flow.currentNodeId = shouldRedirect;
                    flow.status = 'running';
                    await flow.resume(msg.effectiveInput || msg.body);
                } else if (flow.status === 'idle') {
                    console.log(`[WhatsApp Flow] 🎬 Starting flow instance for contact ${orgId}`);
                    flow.start(settings.compiledFlow);
                    if (entrypoints['default']) {
                        flow.currentNodeId = entrypoints['default'].id;
                    } else if (entryKeys.length > 0) {
                        flow.currentNodeId = entrypoints[entryKeys[0]].id; // fallback
                    }
                    flow.status = 'running';
                    await flow.resume(msg.effectiveInput || msg.body);
                } else {
                    console.log(`[WhatsApp Flow] 📥 Handing user message "${msg.body}" to active flow (status: '${flow.status}', currentNode: '${flow.currentNodeId}')`);
                    await flow.step(msg.effectiveInput || msg.body);
                    await flow.resume();
                }

                console.log(`[WhatsApp Flow] ✅ Flow reply sequence completed for contact ${orgId}`);

                return; // Stop processing further for Flow Reply
            }

            // Direct AI Mode (Fallback)
            if (settings && (settings.replyMethod === 'ai' || (settings.replyMethod === undefined && settings.aiEnabled))) {
                const bufferKey = `${msg.from}_${accountId}`;
                if (!aiBuffers.has(bufferKey)) aiBuffers.set(bufferKey, { messages: [], timeout: null });

                const buffer = aiBuffers.get(bufferKey);
                buffer.messages.push(msg.body);
                clearTimeout(buffer.timeout);

                console.log(`[WhatsApp ${account.sessionId}] ⏳ Buffering message from ${msg.from} for AI processing...`);

                buffer.timeout = setTimeout(async () => {
                    const combinedMsg = buffer.messages.join('\n');
                    aiBuffers.delete(bufferKey);

                    console.log(`[WhatsApp ${account.sessionId}] 🧠 Sending message batch to AI for ${msg.from}...`);

                    const promptData = {
                        organization_name: (settings.aiConfig && settings.aiConfig.organizationName) ? settings.aiConfig.organizationName : (accountData ? accountData.pushName || 'Our Organization' : 'Our Organization'),
                        conversation_summary: 'None yet',
                        recent_messages: combinedMsg,
                        global_customer_data: '{}',
                        knowledge_chunks: 'No additional knowledge provided.',
                        knowledge: 'No additional knowledge provided.',
                        messages: combinedMsg,
                        organization_contact_data: '{}',
                        global_customer_facts: 'None',
                        global_customer_profile: '{}',
                        message_language: 'Infer from recent messages',
                        preferred_language: 'Unknown',
                        supported_languages: (settings?.supportedLanguages || ['en']).join(', '),
                        default_language: settings?.defaultLanguage || 'en',
                        organization_customer_facts: 'None',
                        organization_customer_profile: '{}'
                    };

                    let configStr = '';

                    // Include any legacy AI Config text if they still exist
                    if (settings.aiConfig) {
                        if (settings.aiConfig.personality) configStr += `PERSONALITY:\n${settings.aiConfig.personality}\n\n`;
                        if (settings.aiConfig.behavior) configStr += `BEHAVIOR:\n${settings.aiConfig.behavior}\n\n`;
                        if (settings.aiConfig.communicationStyle) configStr += `COMMUNICATION STYLE:\n${settings.aiConfig.communicationStyle}\n\n`;
                        if (settings.aiConfig.brandIdentity) configStr += `BRAND IDENTITY:\n${settings.aiConfig.brandIdentity}\n\n`;
                    }

                    // Include dynamic company details
                    if (settings.customCompanyDetails && settings.customCompanyDetails.length > 0) {
                        configStr += `COMPANY / BUSINESS DETAILS:\n`;
                        settings.customCompanyDetails.forEach(detail => {
                            configStr += `- **${detail.key}**: ${detail.value}\n`;
                        });
                        configStr += `\n`;
                    }

                    if (configStr) {
                        promptData.knowledge_chunks = configStr + (promptData.knowledge_chunks === 'No additional knowledge provided.' ? '' : promptData.knowledge_chunks);
                        promptData.knowledge = promptData.knowledge_chunks;
                    }

                    // Inject live Google Sheets data (60s cache)
                    if (settings.googleSheetUrl) {
                        try {
                            const sheetData = await fetchSheetData(accountId.toString(), settings.googleSheetUrl);
                            if (sheetData) {
                                promptData.knowledge_chunks += `\nLIVE DATABASE (Google Sheet):\n${sheetData}`;
                                promptData.knowledge += `\nLIVE DATABASE (Google Sheet):\n${sheetData}`;
                            }
                        } catch (e) {
                            console.error(`[WhatsApp ${account.sessionId}] ❌ Google Sheet injection error:`, e.message);
                        }
                    }

                    let orgContactIdForAnalysis = null;
                    let currentCustomerDoc = null;
                    try {
                        if (msg.orgContactId) {
                            orgContactIdForAnalysis = msg.orgContactId;
                            const orgContact = await OrganizationContact.findById(msg.orgContactId).populate('customer');

                            if (orgContact) {
                                promptData.organization_contact_data = JSON.stringify(orgContact.organizationProfile || {});
                                promptData.organization_customer_profile = JSON.stringify(orgContact.organizationProfile || {});

                                if (orgContact.organizationProfile?.summary) {
                                    promptData.conversation_summary = orgContact.organizationProfile.summary;
                                }

                                if (orgContact.organizationProfile?.facts && orgContact.organizationProfile.facts.length > 0) {
                                    promptData.organization_customer_facts = orgContact.organizationProfile.facts.map(f => `- ${f.text}`).join('\n');
                                }

                                if (orgContact.customer) {
                                    currentCustomerDoc = orgContact.customer;
                                    promptData.global_customer_data = JSON.stringify(orgContact.customer.globalProfile || {});
                                    promptData.global_customer_profile = JSON.stringify(orgContact.customer.globalProfile || {});

                                    if (orgContact.customer.globalProfile?.preferredLanguage) {
                                        promptData.preferred_language = orgContact.customer.globalProfile.preferredLanguage;
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        console.error(`[WhatsApp ${account.sessionId}] ❌ Error fetching context for AI:`, e.message);
                    }

                    const rawAiResponse = await getAIResponse(combinedMsg, promptData);
                    if (rawAiResponse) {
                        console.log(`[WhatsApp ${account.sessionId}] ✨ AI response generated for ${msg.from}`);

                        // Fetch fresh customer document to ensure latest detected preferredLanguage is used
                        const freshCustomer = await Customer.findOne({ phoneNumber: user }) || currentCustomerDoc;
                        const aiResponse = await processOutgoingMessage(rawAiResponse, freshCustomer, settings);

                        try {
                            const isTypingEnabled = settings?.sendTyping !== false;
                            if (isTypingEnabled) {
                                try {
                                    const chat = await msg.getChat();
                                    if (chat.sendPresence) {
                                        await chat.sendPresence('composing');
                                    } else if (chat.sendStateTyping) {
                                        await chat.sendStateTyping();
                                    }
                                } catch (chatErr) {
                                    console.warn(`[WhatsApp ${account.sessionId}] ⚠️ Skipping typing indicator: could not fetch chat window for ${msg.from}`);
                                }

                                const delay = (settings.typingTime !== undefined && settings.typingTime !== null) ? settings.typingTime : 3000;
                                if (delay > 0) {
                                    await new Promise(r => setTimeout(r, delay));
                                }
                            }

                            try {
                                await msg.reply(aiResponse);
                                console.log(`[WhatsApp ${account.sessionId}] 📤 AI reply sent successfully to ${msg.from}`);
                            } catch (replyErr) {
                                console.warn(`[WhatsApp ${account.sessionId}] ⚠️ msg.reply() failed, falling back to client.sendMessage() for ${msg.from}`);
                                const theClient = clients.get(accountId.toString());
                                if (theClient) {
                                    await theClient.sendMessage(msg.from, aiResponse);
                                    console.log(`[WhatsApp ${account.sessionId}] 📤 AI fallback message sent successfully to ${msg.from}`);
                                }
                            }
                        } catch (e) {
                            console.error(`[WhatsApp ${account.sessionId}] ❌ Critical error replying to user:`, e.stack || e);
                        }

                        try {
                            if (msg.orgContactId) {
                                const botMsg = new Message({
                                    organizationContact: msg.orgContactId,
                                    role: 'bot',
                                    content: aiResponse,
                                    messageType: 'text'
                                });
                                await botMsg.save();
                                ioInstance.emit('new_message', {
                                    accountId,
                                    orgContactId: msg.orgContactId.toString(),
                                    message: { _id: botMsg._id, role: 'bot', content: aiResponse, messageType: 'text', timestamp: botMsg.timestamp }
                                });
                            }

                            if (orgContactIdForAnalysis) {
                                queueCustomerAnalysis(orgContactIdForAnalysis);
                                console.log(`[WhatsApp ${account.sessionId}] 🔄 Queued customer analysis for contact ${orgContactIdForAnalysis}`);
                            }
                        } catch (e) {
                            console.error(`[WhatsApp ${account.sessionId}] ❌ Error saving AI reply to DB:`, e.message);
                        }
                    } else {
                        console.warn(`[WhatsApp ${account.sessionId}] ⚠️ AI returned an empty response for ${msg.from}`);
                    }
                }, 2000); // 2000 ms wait time
            } else {
                console.log(`[WhatsApp ${account.sessionId}] 🛑 AI is disabled for this account. Message from ${msg.from} was logged but not replied to.`);
            }
        } catch (err) {
            console.error(`[WhatsApp ${account.sessionId}] ❌ Error processing message logic:`, err.message);
        }
    });

    client.on('disconnected', async (reason) => {
        console.warn(`[WhatsApp ${account.sessionId}] 🔌 Client disconnected. Reason: ${reason}`);
        await Account.findByIdAndUpdate(accountId, { status: 'disconnected', lastQR: null });
        ioInstance.emit('account_disconnected', { accountId });
        ioInstance.emit('system_log', `[${account.sessionId}] Disconnected: ${reason}`);
    });

    client.initialize().catch(async (err) => {
        console.error(`[WhatsApp ${account.sessionId}] ❌ Failed to initialize client:`, err.message);
        // Clean up the dead client so it doesn't linger
        try { await client.destroy(); } catch (_) { }
        clients.delete(accountId);
        await Account.findByIdAndUpdate(accountId, { status: 'disconnected' });
    });
};

const stopClient = async (accountId) => {
    console.log(`[WhatsApp Manager] 🛑 Stopping client for account ${accountId}...`);
    const client = clients.get(accountId.toString());
    if (client) {
        try {
            await client.destroy();
            console.log(`[WhatsApp Manager] ✅ Successfully destroyed client ${accountId}`);
        } catch (e) {
            console.error(`[WhatsApp Manager] ❌ Error destroying client [${accountId}]:`, e.message);
        }
        clients.delete(accountId.toString());
    } else {
        console.warn(`[WhatsApp Manager] ⚠️ Attempted to stop client ${accountId} but it was not running.`);
    }
};

const resetActiveFlows = async (accountId) => {
    try {
        const contacts = await OrganizationContact.find({ account: accountId });
        for (const contact of contacts) {
            const orgId = contact._id.toString();
            activeFlows.delete(orgId);
            await OrganizationContact.findByIdAndUpdate(contact._id, {
                flowState: { currentNodeId: null, variables: {}, status: 'idle' }
            });
        }
        console.log(`[WhatsApp Manager] ♻️ Reset active flows for account ${accountId}`);
    } catch (e) {
        console.error(`[WhatsApp Manager] ❌ Error resetting active flows for account ${accountId}:`, e.message);
        throw e;
    }
};

// Start a client specifically in pairing code mode
const startClientWithPairing = async (accountId, phoneNumber) => {
    accountId = accountId.toString();
    // Store the phone number in sessionManager so QR event uses pairing instead
    sessionManager.setPairingPhoneNumber(accountId, phoneNumber);
    // Start the client normally — the QR event will detect the pairing number
    startClient(accountId);
};

// Clear active flow for a single organization contact
const clearActiveFlow = (orgContactId) => {
    const orgId = orgContactId.toString();
    if (activeFlows.has(orgId)) {
        activeFlows.delete(orgId);
        console.log(`[WhatsApp Manager] ♻️ Cleared active flow for contact ${orgId}`);
    }
};

module.exports = { init, startClient, stopClient, resetActiveFlows, startClientWithPairing, clearActiveFlow };
