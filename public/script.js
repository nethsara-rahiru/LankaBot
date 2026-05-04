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
        dbStatusBadge.className = 'status-indicator connected';
        icon.className = 'ph-fill ph-database';
    } else {
        span.textContent = 'DB: Offline';
        dbStatusBadge.className = 'status-indicator disconnected';
        icon.className = 'ph-bold ph-database';
    }
});

socket.on('disconnected', () => {
    window.location.href = '/connect.html';
});

socket.on('require_connect', () => {
    if (window.location.pathname === '/' || window.location.pathname === '/dashboard.html') {
        window.location.href = '/connect.html';
    }
});

socket.on('qr', () => {
    // If we receive a QR event while on the dashboard page, redirect to connect
    if (window.location.pathname === '/' || window.location.pathname === '/dashboard.html') {
        window.location.href = '/connect.html';
    }
});

socket.on('ready', (data) => {
    // If we are on connect page, redirect to dashboard
    if (window.location.pathname === '/connect.html') {
        window.location.href = '/dashboard.html';
        return;
    }

    // Update Header Status
    const span = statusBadge.querySelector('span');
    const icon = statusBadge.querySelector('i');
    span.textContent = 'WhatsApp: Connected';
    statusBadge.className = 'status-indicator connected';
    icon.className = 'ph-fill ph-whatsapp-logo';
    
    // Update Header User Profile
    if (data) {
        document.getElementById('user-profile-header').style.display = 'flex';
        document.getElementById('header-account-name').textContent = data.name;
        document.getElementById('header-account-number').textContent = data.number;
        
        const pic = document.getElementById('header-account-pic');
        const defaultPic = `https://ui-avatars.com/api/?name=${encodeURIComponent(data.name)}&background=2ecc71&color=fff`;
        pic.src = data.profilePic || defaultPic;

        // Also update the card if it exists (for compatibility)
        const cardName = document.getElementById('account-name');
        if (cardName) {
            cardName.textContent = data.name;
            document.getElementById('account-number').textContent = data.number;
            const cardPic = document.getElementById('account-pic');
            if (cardPic) {
                cardPic.src = data.profilePic || defaultPic;
                cardPic.style.display = 'block';
            }
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
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to logout? This will require you to scan the QR code again.')) {
            socket.emit('logout');
        }
    });
}

if (sendForm) {
    sendForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const phoneInput = document.getElementById('phone');
        const messageInput = document.getElementById('message');
        const sendBtn = document.getElementById('send-btn');
        
        const phone = phoneInput.value;
        const message = messageInput.value;

        // Loading state
        if (sendBtn) {
            sendBtn.disabled = true;
            sendBtn.innerHTML = '<span>Sending...</span><i class="ph-bold ph-spinner"></i>';
        }

        socket.emit('send_message', { phone, message }, (response) => {
            if (sendBtn) {
                sendBtn.disabled = false;
                sendBtn.innerHTML = '<span>Send Message</span><i class="ph-bold ph-paper-plane-right"></i>';
            }
            
            if (response.success) {
                addLog(`You -> ${phone}: ${message}`, 'outgoing');
                messageInput.value = '';
            } else {
                addLog(`Error: ${response.error}`, 'system');
            }
        });
    });
}

function addLog(text, type) {
    if (!logsContainer) return;
    
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
