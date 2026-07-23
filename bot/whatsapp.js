const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const Rule = require('../models/Rule');
const Settings = require('../models/Settings');
const Account = require('../models/Account');
const Customer = require('../models/Customer');
const OrganizationContact = require('../models/OrganizationContact');
const Message = require('../models/Message');
const AILog = require('../models/AILog');
const { getGroqResponse } = require('../utils/groq');
const { queueCustomerAnalysis } = require('../controllers/customerController');
const qrcodeImage = require('qrcode');
const FlowRuntime = require('../public/FlowManager/Runtime/runtime');

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
        client = new Client({
            authStrategy: new LocalAuth({ clientId: account._id.toString() }),
            puppeteer: {
                headless: 'new', // 'new' is often faster in modern Chrome
                timeout: 60000,
                executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                args: [
                    '--no-sandbox', 
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote'
                ]
            }
        });
    } catch (error) {
        console.error(`[WhatsApp ${account.sessionId}] ❌ Error instantiating client:`, error.message);
        await Account.findByIdAndUpdate(accountId, { status: 'disconnected' });
        return;
    }

    clients.set(accountId, client);

    client.on('qr', async (qr) => {
        console.log(`[WhatsApp ${account.sessionId}] 🔄 QR Code generated, waiting for scan...`);
        const url = await qrcodeImage.toDataURL(qr);
        await Account.findByIdAndUpdate(accountId, { status: 'qr', lastQR: url });
        ioInstance.emit('account_qr', { accountId, qr: url });
        ioInstance.emit('system_log', `[${account.sessionId}] QR Code generated.`);
    });

    client.on('ready', async () => {
        const info = client.info;
        console.log(`[WhatsApp ${account.sessionId}] ✅ Client is READY and connected as ${info.pushname} (${info.wid.user})`);
        
        let profilePicUrl = '';
        try { 
            profilePicUrl = await client.getProfilePicUrl(info.wid._serialized); 
        } catch (e) {
            console.warn(`[WhatsApp ${account.sessionId}] ⚠️ Could not fetch profile picture:`, e.message);
        }

        const updatedAccount = await Account.findByIdAndUpdate(accountId, {
            status: 'ready',
            lastQR: null,
            phoneNumber: info.wid.user,
            pushName: info.pushname,
            profilePic: profilePicUrl
        }, { returnDocument: 'after' });

        ioInstance.emit('account_ready', {
            accountId,
            accountInfo: {
                name: updatedAccount.pushName,
                number: updatedAccount.phoneNumber,
                profilePic: updatedAccount.profilePic
            }
        });
        ioInstance.emit('system_log', `[${account.sessionId}] Connected as ${info.pushname}`);
    });

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

            // 3. Save Message
            const newMsg = new Message({
                organizationContact: orgContact._id,
                role: 'user',
                content: msg.body,
                messageType: msg.type || 'text'
            });
            await newMsg.save();
            
            // Note: attach orgContact._id to msg object for later use
            msg.orgContactId = orgContact._id;
            msg.customerId = customer._id;

        } catch(e) { 
            console.error(`[WhatsApp ${account.sessionId}] ❌ Customer/Message logging error:`, e.message); 
        }

        try {
            // Find Rules for THIS account, sorted by priority (1 is highest priority)
            const rules = await Rule.find({ account: accountId, active: true }).sort({ priority: 1 });
            const matchedRule = rules.find(r => {
                const body = (msg.body || '').toLowerCase();
                const trigger = r.trigger.toLowerCase();

                switch(r.matchType) {
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
                console.log(`[WhatsApp ${account.sessionId}] ⚡ Rule matched! Trigger: "${matchedRule.trigger}". Sending static reply.`);
                await msg.reply(matchedRule.reply);
                ioInstance.emit('system_log', `[Account ${account.sessionId}] Auto-replied to ${user} via Rule`);

                try {
                    if (msg.orgContactId) {
                        const botMsg = new Message({
                            organizationContact: msg.orgContactId,
                            role: 'bot',
                            content: matchedRule.reply,
                            messageType: 'text'
                        });
                        await botMsg.save();
                    }
                } catch(e) {
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
                    const topics = entryKeys.map(k => `- Topic ID: ${k}, Description: ${entrypoints[k].description}`).join('\n');
                    let currentContext = 'The user is starting a NEW conversation. There is no active flow.';
                    if (flow && flow.status !== 'idle') {
                        currentContext = `The user is currently in an ACTIVE flow. You MUST assume their message is a response to the ongoing flow (output "continue"), UNLESS they are explicitly demanding to change the subject to one of the available flows.`;
                    }

                    const routerPrompt = `You are a conversational router AI for a WhatsApp bot.
The user sent a new message: "${msg.body}"

CONTEXT:
${currentContext}

Available flows:
${topics}

Based on the user's message, decide if they are trying to start or switch to one of the available flows.
If the message is a normal continuation of the current conversation and does NOT indicate a deliberate topic change, output "continue".
If the message clearly matches one of the flow descriptions, output the EXACT Topic ID.
Output ONLY "continue" or the Topic ID. Nothing else.`;
                    
                    try {
                        const routeRes = (await getGroqResponse(msg.body, routerPrompt, 1)) || 'continue';
                        const decidedRoute = routeRes.trim();
                        if (decidedRoute !== 'continue' && entrypoints[decidedRoute]) {
                            shouldRedirect = entrypoints[decidedRoute].id;
                        } else if (flow.status === 'idle' && entrypoints['default']) {
                            shouldRedirect = entrypoints['default'].id;
                        }
                    } catch(e) {
                        console.error('Router error', e);
                    }
                }
                
                // 3. Bind Callbacks if it's a new instance
                if (isNewFlowInstance) {
                    
                    // Bind Callbacks
                    flow.resume = async () => {
                        if (flow._isRunning) return;
                        flow._isRunning = true;
                        while (flow.status === 'running') {
                            await flow.step(null);
                            await new Promise(r => setTimeout(r, 100)); // small delay to ensure order
                        }
                        flow._isRunning = false;
                    };
                    
                    flow.onBotMessage = async (text) => {
                        // Count words and wait 0.4 seconds per word, max 3 seconds
                        const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
                        const typingMs = Math.min(wordCount * 400, 3000); 
                        try {
                            const chat = await msg.getChat();
                            if (chat.sendPresence) await chat.sendPresence('composing');
                            else if (chat.sendStateTyping) await chat.sendStateTyping();
                        } catch(e) {}
                        
                        await new Promise(r => setTimeout(r, typingMs));

                        await msg.reply(text);
                        try {
                            const botMsg = new Message({
                                organizationContact: msg.orgContactId,
                                role: 'bot',
                                content: text,
                                messageType: 'text'
                            });
                            await botMsg.save();
                        } catch(e) {
                            console.error('Error saving Flow bot message to DB:', e);
                        }
                    };
                    
                    flow.onWaitingForInput = async (prompt) => {
                        await msg.reply(prompt);
                        try {
                            const botMsg = new Message({
                                organizationContact: msg.orgContactId,
                                role: 'bot',
                                content: prompt,
                                messageType: 'text'
                            });
                            await botMsg.save();
                        } catch(e) {
                            console.error('Error saving Flow input prompt to DB:', e);
                        }
                    };
                    
                    flow.onWaitingForOption = async (prompt, options) => {
                        let text = prompt;
                        await msg.reply(text);
                        try {
                            const botMsg = new Message({
                                organizationContact: msg.orgContactId,
                                role: 'bot',
                                content: text,
                                messageType: 'text'
                            });
                            await botMsg.save();
                        } catch(e) {
                            console.error('Error saving Flow option prompt to DB:', e);
                        }
                    };
                    
                    flow.onWait = (seconds) => {
                        setTimeout(() => {
                            setTimeout(() => flow.resume(), 50); // Resume after runtime's internal timer
                        }, seconds * 1000);
                    };
                    
                    flow.onAIExtract = async (data) => {
                        let systemPrompt = `You are a strict data extraction AI.\nYour task is to extract information from the user's response based on the original question and the specific extraction instructions.\n\nORIGINAL QUESTION TO USER:\n"${data.userPrompt}"\n\nEXTRACTION INSTRUCTION (AI PROMPT):\n"${data.aiPrompt}"\n\nAVAILABLE OPTIONS:\n${data.options && data.options.length > 0 ? data.options.join(', ') : 'None'}\n\nRULES:\n`;
                        
                        if (data.isBoolean) {
                            systemPrompt += `1. Evaluate the boolean condition.\n2. Output a JSON object: {"value": true} or {"value": false}\n3. Output ONLY valid JSON.`;
                        } else {
                            systemPrompt += `1. Extract exactly what is asked in the EXTRACTION INSTRUCTION.\n2. If the user successfully provided the requested information, output a JSON object: {"status": "success", "value": "extracted_value"}\n3. If the user's input is invalid, ambiguous, or missing the required information, output a JSON object: {"status": "fail", "followUp": "A helpful response to ask the user again for the correct information."}\n4. If options are provided, "value" must be the closest matching option.\n5. Output ONLY valid JSON.`;
                        }

                        try {
                            const res = await getGroqResponse(data.userInput, systemPrompt, 1);
                            if (res) {
                                flow.step(res);
                            } else {
                                flow.step(data.userInput);
                            }
                        } catch(e) {
                            flow.step(data.userInput);
                        }
                        flow.resume();
                    };

                    flow.onStepChange = async () => {
                        try {
                            await OrganizationContact.findByIdAndUpdate(msg.orgContactId, {
                                flowState: {
                                    currentNodeId: flow.currentNodeId,
                                    variables: flow.variables,
                                    status: flow.status
                                }
                            });
                        } catch(e) {}
                    };
                    
                    flow.onFlowEnd = async () => {
                        activeFlows.delete(orgId);
                        try {
                            await OrganizationContact.findByIdAndUpdate(msg.orgContactId, {
                                flowState: { currentNodeId: null, variables: {}, status: 'idle' }
                            });
                        } catch(e) {}
                    };
                    
                    activeFlows.set(orgId, flow);
                }

                if (shouldRedirect) {
                    // Reset to the new flow entrypoint
                    flow.variables = {};
                    flow.status = 'idle';
                    flow.start(settings.compiledFlow);
                    flow.currentNodeId = shouldRedirect;
                    flow.status = 'running';
                    flow.step(null);
                } else if (flow.status === 'idle') {
                    // Start the flow because of the first message
                    flow.start(settings.compiledFlow);
                    if (entrypoints['default']) {
                        flow.currentNodeId = entrypoints['default'].id;
                    } else if (entryKeys.length > 0) {
                        flow.currentNodeId = entrypoints[entryKeys[0]].id; // fallback
                    }
                    flow.status = 'running';
                    flow.step(null);
                } else {
                    flow.step(msg.body);
                }
                
                // Automatically run until user input is required
                flow.resume();
                
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
                        } catch(e) { 
                            console.error(`[WhatsApp ${account.sessionId}] ❌ Google Sheet injection error:`, e.message); 
                        }
                    }

                    let orgContactIdForAnalysis = null;
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
                                    promptData.global_customer_data = JSON.stringify(orgContact.customer.globalProfile || {});
                                    promptData.global_customer_profile = JSON.stringify(orgContact.customer.globalProfile || {});
                                    
                                    if (orgContact.customer.globalProfile?.preferredLanguage) {
                                        promptData.preferred_language = orgContact.customer.globalProfile.preferredLanguage;
                                    }
                                }
                            }
                        }
                    } catch(e) { 
                        console.error(`[WhatsApp ${account.sessionId}] ❌ Error fetching context for AI:`, e.message); 
                    }
                    
                    const aiResponse = await getGroqResponse(combinedMsg, promptData);
                    if (aiResponse) {
                        console.log(`[WhatsApp ${account.sessionId}] ✨ AI response generated for ${msg.from}`);
                        
                        try {
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
                            
                            await new Promise(r => setTimeout(r, settings.typingTime || 3000));
                            
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
                            }

                            if (orgContactIdForAnalysis) {
                                queueCustomerAnalysis(orgContactIdForAnalysis);
                                console.log(`[WhatsApp ${account.sessionId}] 🔄 Queued customer analysis for contact ${orgContactIdForAnalysis}`);
                            }
                        } catch(e) { 
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
        try { await client.destroy(); } catch(_) {}
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
    } catch(e) {
        console.error(`[WhatsApp Manager] ❌ Error resetting active flows for account ${accountId}:`, e.message);
        throw e;
    }
};

module.exports = { init, startClient, stopClient, resetActiveFlows };
