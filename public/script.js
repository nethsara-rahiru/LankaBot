const socket = io();

// Auth Check
const token = localStorage.getItem('token');
const userData = JSON.parse(localStorage.getItem('user') || '{}');
const activeAccountId = localStorage.getItem('activeAccountId');

if (!token && !['/login.html', '/register.html', '/index.html', '/'].includes(window.location.pathname)) {
    window.location.href = '/login.html';
}

// Redirect to accounts selection if on dashboard/settings but no account active
if (token && !activeAccountId && !['/login.html', '/register.html', '/index.html', '/', '/accounts.html'].includes(window.location.pathname)) {
    window.location.href = '/accounts.html';
}

// Initial User UI Update
document.addEventListener('DOMContentLoaded', () => {
    if (userData.name) {
        const headerName = document.getElementById('header-account-name');
        if (headerName) headerName.textContent = userData.name;
        
        const headerProfile = document.getElementById('user-profile-header');
        if (headerProfile) headerProfile.style.display = 'flex';
        
        const headerPic = document.getElementById('header-account-pic');
        if (headerPic) {
            headerPic.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(userData.name)}&background=2ecc71&color=fff`;
        }
    }

    // Load status for active account
    if (activeAccountId) {
        socket.emit('get_status', activeAccountId);
    }
});

const qrImage = document.getElementById('qr-code');
const qrMessage = document.getElementById('qr-message');
const qrContainer = document.getElementById('qr-container');
const readyMessage = document.getElementById('ready-message');
const statusBadge = document.getElementById('status-badge');
const dbStatusBadge = document.getElementById('db-status-badge');
const logsContainer = document.getElementById('logs');
const sendForm = document.getElementById('send-form');
const logoutBtn = document.getElementById('logout-btn');

// Socket Events for Multi-Account
socket.on('account_qr', (data) => {
    if (data.accountId === activeAccountId && qrImage) {
        qrImage.src = data.qr;
        if (qrContainer) qrContainer.style.display = 'block';
        if (readyMessage) readyMessage.style.display = 'none';
    }
});

socket.on('account_ready', (data) => {
    if (data.accountId === activeAccountId) {
        updateWhatsAppHeader(true, data.accountInfo);
        if (qrContainer) qrContainer.style.display = 'none';
        if (readyMessage) readyMessage.style.display = 'block';
    }
});

socket.on('account_status', (data) => {
    if (data.accountId === activeAccountId) {
        const isReady = data.status === 'ready';
        updateWhatsAppHeader(isReady, data.accountInfo);
        if (data.status === 'qr' && qrImage) {
            qrImage.src = data.lastQR;
        }
    }
});

function updateWhatsAppHeader(isConnected, info) {
    if (!statusBadge) return;
    const span = statusBadge.querySelector('span');
    const icon = statusBadge.querySelector('i');
    
    if (isConnected) {
        span.textContent = `WA: ${info.name || 'Connected'}`;
        statusBadge.className = 'status-indicator connected';
        icon.className = 'ph-fill ph-whatsapp-logo';
    } else {
        span.textContent = 'WhatsApp: Disconnected';
        statusBadge.className = 'status-indicator disconnected';
        icon.className = 'ph-bold ph-whatsapp-logo';
    }
}

socket.on('message_log', (data) => {
    if (data.accountId === activeAccountId) {
        addLog(`${data.from}: ${data.body}`, 'incoming');
    }
});

socket.on('db_status', (isConnected) => {
    if (!dbStatusBadge) return;
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

socket.on('system_log', (msg) => {
    addLog(msg, 'system');
});

// Form Handling
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to logout?')) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            localStorage.removeItem('activeAccountId');
            window.location.href = '/login.html';
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

        socket.emit('send_message', { accountId: activeAccountId, phone, message }, (response) => {
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
