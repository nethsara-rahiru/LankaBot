const socket = io();

const qrImage = document.getElementById('qr-code');
const qrMessage = document.getElementById('qr-message');
const qrContainer = document.getElementById('qr-container');
const readyMessage = document.getElementById('ready-message');
const statusBadge = document.getElementById('status-badge');
const dbStatusBadge = document.getElementById('db-status-badge');
const logsContainer = document.getElementById('logs');
const sendForm = document.getElementById('send-form');
const logoutBtn = document.getElementById('logout-btn');

// Socket Events
socket.on('db_status', (isConnected) => {
    const span = dbStatusBadge.querySelector('span');
    const icon = dbStatusBadge.querySelector('i');
    if (isConnected) {
        span.textContent = 'DB: Online';
        dbStatusBadge.className = 'badge connected';
        icon.className = 'ph-fill ph-database';
    } else {
        span.textContent = 'DB: Offline';
        dbStatusBadge.className = 'badge disconnected';
        icon.className = 'ph-bold ph-database';
    }
});

socket.on('disconnected', () => {
    window.location.href = '/connect.html';
});

socket.on('require_connect', () => {
    if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
        window.location.href = '/connect.html';
    }
});

socket.on('qr', () => {
    // If we receive a QR event while on the index page, redirect to connect
    if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
        window.location.href = '/connect.html';
    }
});

socket.on('ready', (data) => {
    // If we are on connect page, redirect to dashboard
    if (window.location.pathname === '/connect.html') {
        window.location.href = '/';
        return;
    }

    statusBadge.querySelector('span').textContent = 'WhatsApp: Connected';
    statusBadge.className = 'badge connected';
    icon.className = 'ph-fill ph-whatsapp-logo';
    
    if (data) {
        document.getElementById('account-name').textContent = data.name;
        document.getElementById('account-number').textContent = data.number;
        if (data.profilePic) {
            const pic = document.getElementById('account-pic');
            pic.src = data.profilePic;
            pic.style.display = 'block';
        }
    }

    addLog('WhatsApp Bot is Ready!', 'system');
});

socket.on('message_log', (data) => {
    addLog(`${data.from}: ${data.body}`, 'incoming');
});

socket.on('system_log', (msg) => {
    addLog(msg, 'system');
});

// Form Handling
logoutBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to logout? This will require you to scan the QR code again.')) {
        socket.emit('logout');
    }
});

sendForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const phoneInput = document.getElementById('phone');
    const messageInput = document.getElementById('message');
    const sendBtn = document.getElementById('send-btn');
    
    const phone = phoneInput.value;
    const message = messageInput.value;

    // Loading state
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<span>Sending...</span><i class="ph-bold ph-spinner"></i>';

    socket.emit('send_message', { phone, message }, (response) => {
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<span>Send Message</span><i class="ph-bold ph-paper-plane-right"></i>';
        
        if (response.success) {
            addLog(`You -> ${phone}: ${message}`, 'outgoing');
            messageInput.value = '';
        } else {
            addLog(`Error: ${response.error}`, 'system');
        }
    });
});

function addLog(text, type) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    const textSpan = document.createElement('span');
    textSpan.textContent = text;
    
    entry.appendChild(timeSpan);
    entry.appendChild(textSpan);
    
    logsContainer.prepend(entry);
}
