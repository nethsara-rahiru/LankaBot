# 🤖 LankaBot

LankaBot is a powerful, modern WhatsApp automation system integrated with an Express.js backend and a premium web-based dashboard. It allows you to manage your WhatsApp bot, send messages, and monitor activity in real-time through a beautiful web interface.

## 🚀 Features

- **WhatsApp Automation**: Powered by `whatsapp-web.js`.
- **Premium Dashboard**: Real-time web UI with Socket.io integration.
- **QR Authentication**: Scan the QR code directly on your dashboard.
- **Session Persistence**: Stay logged in across server restarts.
- **Auto-Replies**: Interactive commands (e.g., `hello`, `!image`).
- **Media Support**: Send and receive images, videos, and documents.
- **Secure Architecture**: Environment variable support and Git protection for session data.

## 🛠️ Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: MongoDB (via Mongoose)
- **Real-time**: Socket.io
- **WhatsApp**: whatsapp-web.js (Puppeteer)
- **Frontend**: HTML5, CSS3 (Glassmorphism), Vanilla JS

## 📦 Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/nethsara-rahiru/LankaBot.git
    cd LankaBot
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Configure Environment**:
    Create a `.env` file in the root directory:
    ```env
    PORT=5000
    MONGO_URI=mongodb://localhost:27017/lankabot
    ```

4.  **Add Media Assets**:
    Place your sample files in the `assets/` folder:
    - `sample-image.jpg`
    - `sample-video.mp4`
    - `sample-document.pdf`

## 🚦 Getting Started

### Development Mode
Runs the server with `nodemon` for automatic restarts:
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

Once started, open your browser and navigate to **http://localhost:5000** to access the dashboard.

## 📂 Project Structure

```text
LankaBot/
├── bot/                # WhatsApp bot logic & event handlers
├── config/             # Database & global configurations
├── controllers/        # Express route controllers
├── models/             # Mongoose schemas
├── public/             # Web dashboard (HTML/CSS/JS)
├── routes/             # API route definitions
├── assets/             # Media files for bot sharing
├── .env                # Private environment variables
└── index.js            # Main entry point
```

## 🔒 Security

Your WhatsApp session is stored locally in the `.wwebjs_auth/` folder. This folder is ignored by Git to prevent your private session from being shared. **Never share this folder or your `.env` file.**

---
Built with ❤️ by [Nethsara Rahiru](https://github.com/nethsara-rahiru)
