// ─── Auth helpers ────────────────────────────────────────────
const TOKEN_KEY = 'portal_token';
const USER_KEY  = 'portal_user';

function saveAuth(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

function getUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); }
    catch { return null; }
}

function clearAuth() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
}

function requireAuth() {
    if (!getToken()) {
        window.location.href = '/portal/login.html';
        return false;
    }
    return true;
}

// ─── API helpers ─────────────────────────────────────────────
async function apiFetch(path, options = {}) {
    const token = getToken();
    const res = await fetch(path, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'x-auth-token': token } : {}),
            ...(options.headers || {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.msg || 'Request failed'), { status: res.status, data });
    return data;
}

// ─── Status helpers ───────────────────────────────────────────
function statusBadge(status) {
    const map = {
        ready:        { cls: 'badge-active',  label: 'Active' },
        connecting:   { cls: 'badge-qr',      label: 'Connecting' },
        qr:           { cls: 'badge-qr',      label: 'QR Needed' },
        disconnected: { cls: 'badge-offline', label: 'Disconnected' }
    };
    const s = map[status] || map.disconnected;
    return `<span class="badge ${s.cls}"><span class="badge-dot"></span>${s.label}</span>`;
}

// ─── Alert helpers ────────────────────────────────────────────
function showAlert(el, msg, type = 'error') {
    el.className = `alert alert-${type}`;
    el.textContent = msg;
    el.style.display = 'block';
}

function hideAlert(el) {
    el.style.display = 'none';
}

// ─── Clipboard helper ─────────────────────────────────────────
async function copyToClipboard(text, btn) {
    try {
        await navigator.clipboard.writeText(text);
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1800);
    } catch {
        prompt('Copy this link:', text);
    }
}

// ─── Socket.io loader ─────────────────────────────────────────
function loadSocket(callback) {
    if (window.io) { callback(window.io()); return; }
    const s = document.createElement('script');
    s.src = '/socket.io/socket.io.js';
    s.onload = () => callback(window.io());
    document.head.appendChild(s);
}

// ─── Build share link for an account ─────────────────────────
function buildShareLink(accountId) {
    const token = getToken();
    const base = `${location.protocol}//${location.host}/portal/scan.html`;
    return `${base}?id=${accountId}#${token}`;
}

// ─── API Key helpers ──────────────────────────────────────────
async function fetchApiKey(userId) {
    const path = userId ? `/api/users/api-key?userId=${userId}` : '/api/users/api-key';
    const data = await apiFetch(path);
    return data.apiKey;
}

async function regenerateApiKey(userId) {
    const body = userId ? { userId } : {};
    const data = await apiFetch('/api/users/api-key/generate', {
        method: 'POST',
        body
    });
    return data.apiKey;
}

