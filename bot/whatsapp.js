const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
let ioInstance;
let isReady = false;
let accountInfo = null;

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
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
            if (!err) io.emit('qr', url);
        });
    });

    client.on('authenticated', () => {
        console.log('Authenticated successfully!');
        io.emit('system_log', 'Authenticated! Finalizing connection...');
    });

    client.on('auth_failure', (msg) => {
        isReady = false;
        console.error('Authentication failure:', msg);
        io.emit('system_log', `Auth Failure: ${msg}`);
    });

    client.on('ready', () => {
        const info = client.info;
        isReady = true;
        accountInfo = {
            name: info.pushname,
            number: info.wid.user
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
