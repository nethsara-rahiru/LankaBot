const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const Rule = require('../models/Rule');
const Settings = require('../models/Settings');
const Account = require('../models/Account');
const { getGroqResponse } = require('../utils/groq');
const qrcodeImage = require('qrcode');

let ioInstance;
const clients = new Map(); // accountId -> Client instance
const aiBuffers = new Map(); // userId_accountId -> { messages: [], timeout: null }

// Initialize the manager with Socket.io
const init = async (io) => {
    ioInstance = io;
    console.log('WhatsApp Manager Initialized');

    // Load all active accounts from DB and start them
    try {
        const accounts = await Account.find();
        for (const account of accounts) {
            startClient(account._id);
        }
    } catch (err) {
        console.error('Error loading accounts:', err);
    }

    // Global Socket Events
    io.on('connection', (socket) => {
        socket.on('get_status', async (accountId) => {
            const client = clients.get(accountId.toString());
            if (client) {
                // Return current state
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
            const client = clients.get(accountId.toString());
            if (client) {
                try {
                    await client.logout();
                } catch (err) {
                    console.error('Logout error:', err);
                }
            }
        });

        socket.on('send_message', async (data, callback) => {
            try {
                const { accountId, phone, message } = data;
                const client = clients.get(accountId.toString());
                if (!client) return callback({ success: false, error: 'Client not found' });

                const number = phone.includes('@c.us') ? phone : `${phone}@c.us`;
                await client.sendMessage(number, message);
                callback({ success: true });
            } catch (err) {
                callback({ success: false, error: err.message });
            }
        });
    });
};

const startClient = async (accountId) => {
    accountId = accountId.toString();
    if (clients.has(accountId)) return;

    const account = await Account.findById(accountId);
    if (!account) return;

    console.log(`Starting WhatsApp Client for session: ${account.sessionId}`);
    
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: account.sessionId }),
        webVersionCache: {
            type: 'remote',
            remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
        },
        puppeteer: {
            headless: 'new',
            executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    clients.set(accountId, client);

    client.on('qr', async (qr) => {
        const url = await qrcodeImage.toDataURL(qr);
        await Account.findByIdAndUpdate(accountId, { status: 'qr', lastQR: url });
        ioInstance.emit('account_qr', { accountId, qr: url });
        ioInstance.emit('system_log', `[${account.sessionId}] QR Code generated.`);
    });

    client.on('ready', async () => {
        const info = client.info;
        let profilePicUrl = '';
        try { profilePicUrl = await client.getProfilePicUrl(info.wid._serialized); } catch (e) {}

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

    client.on('message', async (msg) => {
        if (msg.from === 'status@broadcast' || msg.type === 'sticker') return;

        // Check if account is paused
        const accountData = await Account.findById(accountId);
        if (accountData && accountData.paused) {
            console.log(`[Account ${accountId}] Paused - ignoring message.`);
            return;
        }

        const user = msg.from.split('@')[0];
        ioInstance.emit('message_log', { accountId, from: user, body: msg.body || `[${msg.type.toUpperCase()}]` });

        try {
            // Find Rules for THIS account
            const rules = await Rule.find({ account: accountId, active: true });
            const matchedRule = rules.find(r => {
                const body = (msg.body || '').toLowerCase();
                const trigger = r.trigger.toLowerCase();
                
                // Time Check
                if (r.startTime && r.endTime) {
                    const now = new Date();
                    const currentTime = now.getHours() * 60 + now.getMinutes();
                    const [startH, startM] = r.startTime.split(':').map(Number);
                    const [endH, endM] = r.endTime.split(':').map(Number);
                    const startTotal = startH * 60 + startM;
                    const endTotal = endH * 60 + endM;
                    
                    if (startTotal <= endTotal) {
                        if (currentTime < startTotal || currentTime > endTotal) return false;
                    } else {
                        if (currentTime < startTotal && currentTime > endTotal) return false;
                    }
                }

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
                console.log(`[Account ${accountId}] Auto-replying for trigger: ${matchedRule.trigger}`);
                await msg.reply(matchedRule.reply);
                ioInstance.emit('system_log', `[Account ${accountId}] Auto-replied to ${user}`);
                return;
            }

            // AI Fallback for THIS account
            const settings = await Settings.findOne({ account: accountId });
            if (settings && settings.aiEnabled) {
                const bufferKey = `${msg.from}_${accountId}`;
                if (!aiBuffers.has(bufferKey)) aiBuffers.set(bufferKey, { messages: [], timeout: null });
                
                const buffer = aiBuffers.get(bufferKey);
                buffer.messages.push(msg.body);
                clearTimeout(buffer.timeout);

                buffer.timeout = setTimeout(async () => {
                    const combinedMsg = buffer.messages.join('\n');
                    aiBuffers.delete(bufferKey);
                    
                    let fullSystemPrompt = `${settings.aiSystemPrompt}\n\n`;
                    if (settings.aiPersonality) fullSystemPrompt += `PERSONALITY:\n${settings.aiPersonality}\n\n`;
                    if (settings.aiBehavior) fullSystemPrompt += `BEHAVIOR:\n${settings.aiBehavior}\n\n`;
                    if (settings.aiDecisionMaking) fullSystemPrompt += `DECISION-MAKING:\n${settings.aiDecisionMaking}\n\n`;
                    if (settings.aiCommunicationStyle) fullSystemPrompt += `COMMUNICATION STYLE:\n${settings.aiCommunicationStyle}\n\n`;
                    if (settings.aiBrandIdentity) fullSystemPrompt += `BRAND IDENTITY:\n${settings.aiBrandIdentity}\n\n`;
                    if (settings.knowledgeBase) fullSystemPrompt += `KNOWLEDGE BASE / FACTS:\n${settings.knowledgeBase}\n\n`;
                    
                    const aiResponse = await getGroqResponse(combinedMsg, fullSystemPrompt);
                    if (aiResponse) {
                        const chat = await msg.getChat();
                        try {
                            if (chat.sendPresence) {
                                await chat.sendPresence('composing');
                            } else if (chat.sendStateTyping) {
                                await chat.sendStateTyping();
                            }
                        } catch (e) {
                            console.error('Typing indicator error:', e);
                        }
                        await new Promise(r => setTimeout(r, settings.typingTime || 3000));
                        await msg.reply(aiResponse);
                    }
                }, settings.responseTime || 2000);
            }
        } catch (err) {
            console.error('Error processing message:', err);
        }
    });

    client.on('disconnected', async (reason) => {
        await Account.findByIdAndUpdate(accountId, { status: 'disconnected', lastQR: null });
        ioInstance.emit('account_disconnected', { accountId });
        ioInstance.emit('system_log', `[${account.sessionId}] Disconnected: ${reason}`);
    });

    client.initialize().catch(err => {
        console.error(`Failed to initialize client [${account.sessionId}]:`, err);
    });
};

const stopClient = async (accountId) => {
    const client = clients.get(accountId.toString());
    if (client) {
        await client.destroy();
        clients.delete(accountId.toString());
    }
};

module.exports = { init, startClient, stopClient };
