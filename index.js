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

// Init Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Define Routes
app.use('/api/users', require('./routes/userRoutes'));

// Main Dashboard Route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
    console.log(`Dashboard available at http://localhost:${PORT}`);
});
