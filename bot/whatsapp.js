const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const Rule = require('../models/Rule');
const Settings = require('../models/Settings');
const { getGeminiResponse } = require('../utils/ai');
let ioInstance;
let isReady = false;
let accountInfo = null;
let lastQR = null;

const client = new Client({
    authStrategy: new LocalAuth(),
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    },
    puppeteer: {
        headless: 'new',
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-extensions',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', // <- this can help on some systems
            '--disable-gpu'
        ],
    }
});

// Initialize with Socket.io
const init = (io) => {
    ioInstance = io;

    io.emit('system_log', 'Initializing WhatsApp Client...');

    client.on('qr', (qr) => {
        isReady = false;
        accountInfo = null;
        console.log('Scan the QR code in the browser dashboard.');
        io.emit('system_log', 'QR Code generated. Please scan to login.');
        // Generate QR image data URL
        const qrcodeImage = require('qrcode');
        qrcodeImage.toDataURL(qr, (err, url) => {
            if (!err) {
                lastQR = url;
                io.emit('qr', url);
            }
        });
    });

    client.on('authenticated', () => {
        console.log('Authenticated successfully!');
        lastQR = null;
        io.emit('system_log', 'Authenticated! Finalizing connection...');
    });

    client.on('auth_failure', (msg) => {
        isReady = false;
        console.error('Authentication failure:', msg);
        io.emit('system_log', `Auth Failure: ${msg}`);
    });

    client.on('ready', async () => {
        const info = client.info;
        isReady = true;
        lastQR = null;
        
        let profilePicUrl = '';
        try {
            profilePicUrl = await client.getProfilePicUrl(info.wid._serialized);
        } catch (err) {
            console.log('Could not fetch profile pic');
        }

        accountInfo = {
            name: info.pushname,
            number: info.wid.user,
            profilePic: profilePicUrl
        };
        console.log('WhatsApp Client is ready!');
        
        io.emit('ready', accountInfo);
        io.emit('system_log', `Connected as ${info.pushname} (${info.wid.user})`);
    });

    client.on('loading_screen', (percent, message) => {
        console.log('LOADING SCREEN', percent, message);
        io.emit('system_log', `Loading: ${percent}% - ${message}`);
    });

    client.on('message', async (msg) => {
        const user = msg.from.split('@')[0];
        console.log(`Message from ${user}: ${msg.body}`);
        
        io.emit('message_log', { from: user, body: msg.body });

        // Rule-based Auto Replies
        try {
            const rules = await Rule.find({ active: true });
            const matchedRule = rules.find(r => {
                const body = msg.body.toLowerCase();
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
                        // Normal range (e.g. 09:00 - 17:00)
                        if (currentTime < startTotal || currentTime > endTotal) return false;
                    } else {
                        // Overnight range (e.g. 22:00 - 05:00)
                        if (currentTime < startTotal && currentTime > endTotal) return false;
                    }
                }

                switch(r.matchType) {
                    case 'exact':
                        return body === trigger;
                    case 'startsWith':
                        return body.startsWith(trigger);
                    case 'endsWith':
                        return body.endsWith(trigger);
                    case 'fuzzy':
                        // Simple fuzzy: check if trigger exists in body or vice versa, and length ratio
                        const triggerWords = trigger.split(/\s+/);
                        return triggerWords.every(word => body.includes(word)) || body.includes(trigger);
                    case 'regex':
                        try {
                            const regex = new RegExp(r.trigger, 'i');
                            return regex.test(msg.body);
                        } catch (e) {
                            return false;
                        }
                    case 'contains':
                    default:
                        return body.includes(trigger);
                }
            });
            
            if (matchedRule) {
                console.log(`Auto-replying to ${user} for trigger: ${matchedRule.trigger} (${matchedRule.matchType})`);
                msg.reply(matchedRule.reply);
                io.emit('system_log', `Auto-replied to ${user} (Trigger: ${matchedRule.trigger}, Type: ${matchedRule.matchType})`);
                return; // Stop further processing if rule matched
            }

            // AI Fallback (Gemini)
            const settings = await Settings.findOne();
            if (settings && settings.aiEnabled) {
                const aiResponse = await getGeminiResponse(msg.body, settings.aiSystemPrompt);
                if (aiResponse) {
                    console.log(`AI Replying to ${user} using Gemini`);
                    msg.reply(aiResponse);
                    io.emit('system_log', `AI-Replied to ${user} (Powered by Gemini)`);
                    return;
                }
            }
        } catch (err) {
            console.error('Error processing rules/AI:', err);
        }

        // Command logic
        if (msg.body.toLowerCase() === 'hello') {
            msg.reply('Hello from LankaBot Dashboard! 👋');
        }

        if (msg.body.toLowerCase() === '!image') {
            const path = require('path');
            const fs = require('fs');
            const { MessageMedia } = require('whatsapp-web.js');
            const imagePath = path.join(__dirname, '../assets/sample-image.jpg');
            if (fs.existsSync(imagePath)) {
                const media = MessageMedia.fromFilePath(imagePath);
                await client.sendMessage(msg.from, media, { caption: 'Here is your image!' });
            }
        }
        
        // ... add other commands back as needed
    });

    client.on('disconnected', (reason) => {
        isReady = false;
        accountInfo = null;
        console.log('Client was logged out', reason);
        io.emit('system_log', `System: Logged out / Disconnected (${reason})`);
        io.emit('disconnected');
    });

    // Handle events from frontend
    io.on('connection', (socket) => {
        // If already ready, send info immediately to the new connection
        if (isReady && accountInfo) {
            socket.emit('ready', accountInfo);
            socket.emit('system_log', 'Dashboard reconnected. Bot is active.');
        } else if (lastQR) {
            socket.emit('qr', lastQR);
        }

        socket.on('logout', async () => {
            try {
                io.emit('system_log', 'System: Attempting to logout...');
                await client.logout();
                isReady = false;
                accountInfo = null;
                io.emit('disconnected');
                io.emit('system_log', 'System: Logout successful. Please wait for a new QR code.');
            } catch (err) {
                console.error('Logout error:', err);
                io.emit('system_log', `System: Logout error - ${err.message}`);
                // Fallback: If logout fails, just reset the local state
                isReady = false;
                accountInfo = null;
                io.emit('disconnected');
            }
        });

        socket.on('send_message', async (data, callback) => {
            try {
                const number = data.phone.includes('@c.us') ? data.phone : `${data.phone}@c.us`;
                await client.sendMessage(number, data.message);
                callback({ success: true });
            } catch (err) {
                callback({ success: false, error: err.message });
            }
        });
    });

    client.initialize();
};

const getStatus = () => ({
    isReady,
    accountInfo
});

module.exports = { init, client, getStatus };
