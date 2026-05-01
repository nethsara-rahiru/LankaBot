# LankaBot WhatsApp Bot

This bot is powered by `whatsapp-web.js`.

## Features
- **Auto-Reply**: Responds to "hello" with a welcome message.
- **Image Sharing**: Send `!image` to receive a sample image.
- **Video Sharing**: Send `!video` to receive a sample video.
- **Document Sharing**: Send `!document` to receive a sample document.

## Setup
1. Ensure dependencies are installed:
   ```bash
   npm install whatsapp-web.js qrcode-terminal
   ```
2. Place your media files in the `assets/` folder:
   - `sample-image.jpg`
   - `sample-video.mp4`
   - `sample-document.pdf`
3. Start the server:
   ```bash
   npm run dev
   ```
4. Scan the QR code that appears in the terminal using your WhatsApp mobile app (Linked Devices -> Link a Device).

## File Structure
- `bot/whatsapp.js`: Contains the bot client and message handling logic.
- `index.js`: Initializes the bot alongside the Express server.
- `assets/`: Directory for media files to be shared by the bot.
