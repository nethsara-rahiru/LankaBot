const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
let ioInstance;

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

    client.on('qr', (qr) => {
        console.log('Scan the QR code in the browser dashboard.');
        // Generate QR image data URL
        const qrcodeImage = require('qrcode');
        qrcodeImage.toDataURL(qr, (err, url) => {
            if (!err) io.emit('qr', url);
        });
    });

    client.on('ready', () => {
        console.log('WhatsApp Client is ready!');
        io.emit('ready');
    });

    client.on('message', async (msg) => {
        const user = msg.from.split('@')[0];
        console.log(`Message from ${user}: ${msg.body}`);
        
        io.emit('message_log', { from: user, body: msg.body });

        // Original bot logic
        if (msg.body.toLowerCase() === 'hello') {
            msg.reply('Hello from LankaBot Dashboard! 👋');
        }
        
        // ... rest of your message logic here
    });

    // Handle sending messages from frontend
    io.on('connection', (socket) => {
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

module.exports = { init, client };
