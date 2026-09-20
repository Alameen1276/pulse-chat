PULSE v2 - WhatsApp-style chat
==============================

RUN IT (Windows PowerShell)
  1. Open the folder that contains package.json and server.js
  2. npm install
  3. npm start
  4. Open http://localhost:3000

TEST WITH TWO PEOPLE ON ONE COMPUTER
  Each browser stores its own profile, so use two different browsers
  (e.g. Chrome and Edge) or one normal window and one Incognito window.
  Join with two different names, then open each other's chat.

TEST FROM YOUR PHONE
  Messages work over Wi-Fi at the address the server prints ("On your Wi-Fi").
  Voice notes and calls need a secure page (https), which browsers only allow
  on localhost or https. The easiest fix is a tunnel:

    Option A - ngrok (https://ngrok.com, free account)
        ngrok http 3000
    Option B - Cloudflare Tunnel (no account needed)
        cloudflared tunnel --url http://localhost:3000

  Open the https link the tunnel prints on both devices.

WHAT IS INCLUDED
  - Join screen with saved profile ("Remember me")
  - Contact list with online status, last seen, unread badges, search
  - Everyone (group) chat and private chats
  - Sent / delivered / read ticks, typing indicator
  - Voice notes (record, cancel, send, play with waveform)
  - Photos, emoji picker
  - Voice and video calls (WebRTC) with ring tones, mute, camera off
  - Call history in the chat
  - Light and dark theme, mobile layout

NOTES
  - Messages are kept in server memory. Restarting the server clears them.
  - Calls connect directly between devices using free STUN servers. On some
    mobile networks or strict Wi-Fi, a TURN server is needed for calls.
