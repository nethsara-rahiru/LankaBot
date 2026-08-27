const { Client, LocalAuth } = require('whatsapp-web.js');
const Account = require('../models/Account');
const qrcodeImage = require('qrcode');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Map to store phone numbers requested for pairing code mode per accountId
const pairingNumbers = new Map();

/**
 * Resolves Chrome/Chromium executable path based on environment variables and OS platform.
 */
const getBrowserExecutablePath = () => {
    // 1. Check explicitly specified path in environment variable
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        if (fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
            return process.env.PUPPETEER_EXECUTABLE_PATH;
        }
        console.warn(`[SessionManager] ⚠️ PUPPETEER_EXECUTABLE_PATH set to '${process.env.PUPPETEER_EXECUTABLE_PATH}' but file does not exist.`);
    }

    const platform = os.platform();

    if (platform === 'darwin') {
        const macPaths = [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium'
        ];
        for (const p of macPaths) {
            if (fs.existsSync(p)) return p;
        }
    } else if (platform === 'linux') {
        const linuxPaths = [
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/google-chrome'
        ];
        for (const p of linuxPaths) {
            if (fs.existsSync(p)) return p;
        }
    } else if (platform === 'win32') {
        const winPaths = [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
        ];
        for (const p of winPaths) {
            if (fs.existsSync(p)) return p;
        }
    }

    // Return undefined to allow puppeteer / whatsapp-web.js to fallback to its bundled Chromium if available
    return undefined;
};

/**
 * Creates and initializes a WhatsApp Web client instance with optimized Puppeteer settings.
 * 
 * @param {Object} account DB Account document
 * @param {Object} ioInstance Socket.io instance for real-time events
 * @param {Object} callbacks Event callbacks for client readiness and message handling
 * @returns {Promise<Client>} Initialized Client instance
 */
const createClientSession = async (account, ioInstance, callbacks = {}) => {
    const accountId = account._id.toString();
    const executablePath = getBrowserExecutablePath();

    console.log(`[SessionManager ${account.sessionId}] 🚀 Initializing WhatsApp Web Client...`);
    if (executablePath) {
        console.log(`[SessionManager ${account.sessionId}] 🌐 Using browser path: ${executablePath}`);
    } else {
        console.log(`[SessionManager ${account.sessionId}] 🌐 Using default Puppeteer browser binary`);
    }

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: accountId }),
        puppeteer: {
            headless: 'new',
            executablePath: executablePath,
            timeout: 120000, // 120 seconds timeout for slower loading/pairing
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--disable-gpu',
                '--disable-session-crashed-bubble'
            ]
        }
    });

    // Handle QR code generation or Pairing Code request
    client.on('qr', async (qr) => {
        const pairingPhone = pairingNumbers.get(accountId);
        if (pairingPhone) {
            try {
                console.log(`[SessionManager ${account.sessionId}] 🔗 Requesting pairing code for ${pairingPhone}...`);
                const code = await client.requestPairingCode(pairingPhone);
                console.log(`[SessionManager ${account.sessionId}] 🔗 Pairing code generated: ${code}`);
                await Account.findByIdAndUpdate(accountId, { status: 'qr' });
                if (ioInstance) {
                    ioInstance.emit('account_pairing_code', { accountId, code });
                    ioInstance.emit('system_log', `[${account.sessionId}] Pairing code generated for ${pairingPhone}`);
                }
                pairingNumbers.delete(accountId);
            } catch (e) {
                console.error(`[SessionManager ${account.sessionId}] ❌ Pairing code request error:`, e.message);
                console.log(`[SessionManager ${account.sessionId}] 🔄 Falling back to QR code display...`);
                try {
                    const url = await qrcodeImage.toDataURL(qr);
                    await Account.findByIdAndUpdate(accountId, { status: 'qr', lastQR: url });
                    if (ioInstance) {
                        ioInstance.emit('account_qr', { accountId, qr: url });
                        ioInstance.emit('system_log', `[${account.sessionId}] QR Code generated (fallback from pairing code failure).`);
                    }
                } catch (qrErr) {
                    console.error(`[SessionManager ${account.sessionId}] ❌ QR Generation Error:`, qrErr.message);
                }
                pairingNumbers.delete(accountId);
            }
            return;
        }

        console.log(`[SessionManager ${account.sessionId}] 🔄 QR Code generated! Fast rendering QR DataURL...`);
        try {
            const url = await qrcodeImage.toDataURL(qr);
            await Account.findByIdAndUpdate(accountId, { status: 'qr', lastQR: url });
            if (ioInstance) {
                ioInstance.emit('account_qr', { accountId, qr: url });
                ioInstance.emit('system_log', `[${account.sessionId}] QR Code generated.`);
            }
        } catch (e) {
            console.error(`[SessionManager ${account.sessionId}] ❌ Error creating QR DataURL:`, e.message);
        }
    });

    // Handle Ready event
    client.on('ready', async () => {
        const info = client.info;
        console.log(`[SessionManager ${account.sessionId}] ✅ Client READY! Connected as ${info?.pushname} (${info?.wid?.user})`);

        let profilePicUrl = '';
        try {
            profilePicUrl = await client.getProfilePicUrl(info.wid._serialized);
        } catch (e) {
            console.warn(`[SessionManager ${account.sessionId}] ⚠️ Could not fetch profile picture:`, e.message);
        }

        const updatedAccount = await Account.findByIdAndUpdate(accountId, {
            status: 'ready',
            lastQR: null,
            phoneNumber: info.wid.user,
            pushName: info.pushname,
            profilePic: profilePicUrl
        }, { returnDocument: 'after' });

        if (ioInstance) {
            ioInstance.emit('account_ready', {
                accountId,
                accountInfo: {
                    name: updatedAccount.pushName,
                    number: updatedAccount.phoneNumber,
                    profilePic: updatedAccount.profilePic
                }
            });
            ioInstance.emit('system_log', `[${account.sessionId}] Connected as ${info.pushname}`);
        }

        if (callbacks.onReady) {
            callbacks.onReady(updatedAccount);
        }
    });

    // Attach message_create listener if provided
    if (callbacks.onMessage) {
        client.on('message_create', callbacks.onMessage);
    }

    // Handle disconnect event
    client.on('disconnected', async (reason) => {
        console.warn(`[SessionManager ${account.sessionId}] 🔌 Client disconnected. Reason: ${reason}`);
        await Account.findByIdAndUpdate(accountId, { status: 'disconnected', lastQR: null });
        if (ioInstance) {
            ioInstance.emit('account_disconnected', { accountId });
            ioInstance.emit('system_log', `[${account.sessionId}] Disconnected: ${reason}`);
        }
        if (callbacks.onDisconnected) {
            callbacks.onDisconnected(reason);
        }
    });

    return client;
};

/**
 * Register phone number for pairing mode on upcoming initialization
 */
const setPairingPhoneNumber = (accountId, phoneNumber) => {
    pairingNumbers.set(accountId.toString(), phoneNumber);
};

module.exports = {
    createClientSession,
    setPairingPhoneNumber,
    getBrowserExecutablePath
};
