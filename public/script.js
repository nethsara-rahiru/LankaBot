const socket = io();

const qrImage = document.getElementById('qr-code');
const qrMessage = document.getElementById('qr-message');
const qrContainer = document.getElementById('qr-container');
const readyMessage = document.getElementById('ready-message');
const statusBadge = document.getElementById('status-badge');
const dbStatusBadge = document.getElementById('db-status-badge');
const logsContainer = document.getElementById('logs');
const sendForm = document.getElementById('send-form');

// Socket Events
socket.on('db_status', (isConnected) => {
    if (isConnected) {
        dbStatusBadge.textContent = 'DB: Online';
        dbStatusBadge.className = 'badge connected';
    } else {
        dbStatusBadge.textContent = 'DB: Offline';
        dbStatusBadge.className = 'badge disconnected';
    }
});

socket.on('qr', (qrData) => {
    qrImage.src = qrData;
    qrImage.style.display = 'block';
    qrMessage.style.display = 'none';
    addLog('System: QR Code received. Please scan.', 'system');
});

socket.on('ready', () => {
    qrContainer.style.display = 'none';
    readyMessage.style.display = 'block';
    statusBadge.textContent = 'Connected';
    statusBadge.className = 'badge connected';
    addLog('System: WhatsApp Bot is Ready!', 'system');
});

socket.on('message_log', (data) => {
    addLog(`${data.from}: ${data.body}`, 'incoming');
});

socket.on('system_log', (msg) => {
    addLog(`System: ${msg}`, 'system');
});

// Form Handling
sendForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const phone = document.getElementById('phone').value;
    const message = document.getElementById('message').value;

    socket.emit('send_message', { phone, message }, (response) => {
        if (response.success) {
            addLog(`You -> ${phone}: ${message}`, 'outgoing');
            document.getElementById('message').value = '';
        } else {
            addLog(`Error: ${response.error}`, 'system');
        }
    });
});

function addLog(text, type) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const time = new Date().toLocaleTimeString();
    entry.textContent = `[${time}] ${text}`;
    logsContainer.prepend(entry);
}
