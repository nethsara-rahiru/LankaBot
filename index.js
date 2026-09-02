require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/db');
const whatsappBot = require('./bot/whatsapp');

// Initialize Express & HTTP Server
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Connect Database
connectDB();

// Initialize WhatsApp Bot with Socket.io
whatsappBot.init(io);

// Send Status on connection
const mongoose = require('mongoose');
io.on('connection', (socket) => {
    // DB Status
    socket.emit('db_status', mongoose.connection.readyState === 1);
});

// Init Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Define Routes
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/rules', require('./routes/ruleRoutes'));
app.use('/api/settings', require('./routes/settingsRoutes'));
app.use('/api/accounts', require('./routes/accountRoutes'));
app.use('/api/contacts', require('./routes/customerRoutes'));
app.use('/api/simulator', require('./routes/simulatorRoutes'));
app.use('/api/storage', require('./routes/storageRoutes'));
app.use('/api/catalog', require('./routes/catalogRoutes'));
app.use('/api/orders', require('./routes/orderRoutes'));
app.use('/api/external', require('./routes/externalRoutes'));

// Global User Portal — served at /portal
app.use('/portal', express.static(path.join(__dirname, 'Global Frontend')));
app.get('/portal', (req, res) => {
    res.sendFile(path.join(__dirname, 'Global Frontend', 'login.html'));
});

// Main Landing Route (Splash Screen)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
    console.log(`Dashboard available at http://localhost:${PORT}`);
});

// Prevent server crashes from unhandled puppeteer/library errors
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason?.message || reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err.message);
});
