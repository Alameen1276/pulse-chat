const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 15e6 }); // room for voice notes + photos

app.use(express.static(path.join(__dirname, 'public')));

const GROUP = 'group';
const MAX_PER_CHAT = 200;

const users = new Map();   // userId -> { id, name, color, online, lastSeen }
const sockets = new Map(); // userId -> Set(socket.id)   (one user can have several tabs)
const chats = new Map();   // chatKey -> [messages]      ('group' or 'idA|idB')

const pairKey = (a, b) => [a, b].sort().join('|');
const roomOf = (id) => `u:${id}`;
const isOnline = (id) => (sockets.get(id)?.size || 0) > 0;
const userList = () => [...users.values()];

// Small version of a message (no audio/photo data) for chat-list previews
const slim = (m) => ({
  id: m.id, from: m.from, to: m.to, type: m.type, text: m.text,
  duration: m.duration, video: m.video, outcome: m.outcome, ts: m.ts,
});

function summaryFor(uid) {
  const out = {};
  for (const [key, list] of chats) {
    let other;
    if (key === GROUP) other = GROUP;
    else {
      const [a, b] = key.split('|');
      if (a !== uid && b !== uid) continue;
      other = a === uid ? b : a;
    }
    const last = list[list.length - 1];
    const unread = key === GROUP ? 0 : list.filter((m) => m.to === uid && m.status !== 'read').length;
    out[other] = { last: last ? slim(last) : null, unread };
  }
  return out;
}

// When someone comes online, everything sent to them becomes "delivered"
function markDelivered(uid) {
  const bySender = new Map();
  for (const [key, list] of chats) {
    if (key === GROUP || !key.split('|').includes(uid)) continue;
    for (const m of list) {
      if (m.to === uid && m.status === 'sent') {
        m.status = 'delivered';
        if (!bySender.has(m.from)) bySender.set(m.from, []);
        bySender.get(m.from).push(m.id);
      }
    }
  }
  for (const [sender, ids] of bySender) {
    io.to(roomOf(sender)).emit('status', { chat: uid, ids, status: 'delivered' });
  }
}

io.on('connection', (socket) => {
  let me = null;

  socket.on('join', (p, ack) => {
    const id = String(p?.id || '');
    const name = String(p?.name || '').trim().slice(0, 24);
    const color = /^#[0-9a-f]{6}$/i.test(p?.color) ? p.color : '#1fa67a';
    if (!/^[\w-]{6,64}$/.test(id) || name.length < 2) return ack?.({ ok: false, error: 'Invalid profile' });

    me = id;
    users.set(id, { id, name, color, online: true, lastSeen: Date.now() });
    if (!sockets.has(id)) sockets.set(id, new Set());
    sockets.get(id).add(socket.id);
    socket.join(roomOf(id));

    markDelivered(id);
    ack?.({ ok: true, users: userList(), summary: summaryFor(id) });
    io.emit('users', userList());
  });

  socket.on('history', ({ chat } = {}, ack) => {
    if (!me) return;
    const key = chat === GROUP ? GROUP : pairKey(me, String(chat));
    ack?.(chats.get(key) || []);
  });

  socket.on('message', (d = {}, ack) => {
    if (!me) return;
    const to = d.to === GROUP ? GROUP : String(d.to);
    if (to !== GROUP && !users.has(to)) return ack?.({ ok: false });

    const type = ['text', 'audio', 'image', 'call'].includes(d.type) ? d.type : 'text';
    const msg = { id: crypto.randomUUID(), from: me, to, type, ts: Date.now(), status: 'sent' };

    if (type === 'text') {
      msg.text = String(d.text || '').slice(0, 4000);
      if (!msg.text.trim()) return ack?.({ ok: false });
    } else if (type === 'audio') {
      msg.audio = String(d.audio || '');
      msg.duration = Math.min(Number(d.duration) || 0, 300);
      if (!msg.audio.startsWith('data:audio/') || msg.audio.length > 8e6) return ack?.({ ok: false });
    } else if (type === 'image') {
      msg.image = String(d.image || '');
      msg.text = String(d.text || '').slice(0, 1000);
      if (!msg.image.startsWith('data:image/') || msg.image.length > 8e6) return ack?.({ ok: false });
    } else if (type === 'call') {
      msg.video = !!d.video;
      msg.duration = Math.max(0, Number(d.duration) || 0);
      msg.outcome = ['ended', 'missed', 'declined'].includes(d.outcome) ? d.outcome : 'missed';
    }

    if (to !== GROUP && isOnline(to)) msg.status = 'delivered';

    const key = to === GROUP ? GROUP : pairKey(me, to);
    if (!chats.has(key)) chats.set(key, []);
    const list = chats.get(key);
    list.push(msg);
    if (list.length > MAX_PER_CHAT) list.shift();

    (to === GROUP ? io : io.to(roomOf(me)).to(roomOf(to))).emit('message', msg);
    ack?.({ ok: true });
  });

  socket.on('read', ({ chat } = {}) => {
    if (!me || !chat || chat === GROUP) return;
    const list = chats.get(pairKey(me, String(chat)));
    if (!list) return;
    const ids = [];
    for (const m of list) {
      if (m.to === me && m.status !== 'read') { m.status = 'read'; ids.push(m.id); }
    }
    if (ids.length) io.to(roomOf(chat)).emit('status', { chat: me, ids, status: 'read' });
  });

  socket.on('typing', ({ to, typing } = {}) => {
    if (!me) return;
    if (to === GROUP) socket.broadcast.emit('typing', { chat: GROUP, from: me, typing: !!typing });
    else io.to(roomOf(String(to))).emit('typing', { chat: me, from: me, typing: !!typing });
  });

  // ---- Call signalling (the audio/video itself flows peer-to-peer via WebRTC) ----
  socket.on('call:offer', ({ to, offer, video } = {}) => {
    if (!me || !users.has(to)) return;
    if (!isOnline(to)) return socket.emit('call:unavailable', { from: to });
    io.to(roomOf(to)).emit('call:offer', { from: me, offer, video: !!video });
  });
  for (const ev of ['call:answer', 'call:ice', 'call:end', 'call:decline', 'call:busy']) {
    socket.on(ev, ({ to, ...rest } = {}) => {
      if (!me || !to) return;
      io.to(roomOf(to)).emit(ev, { from: me, ...rest });
    });
  }

  socket.on('disconnect', () => {
    if (!me) return;
    const set = sockets.get(me);
    set?.delete(socket.id);
    if (!set?.size) {
      const u = users.get(me);
      if (u) { u.online = false; u.lastSeen = Date.now(); }
      io.emit('users', userList());
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Pulse is running\n`);
  console.log(`  On this computer:  http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) console.log(`  On your Wi-Fi:     http://${i.address}:${PORT}`);
    }
  }
  console.log(`\n  Note: voice/video calls and voice notes need https or localhost.`);
  console.log(`  To test from a phone, run a tunnel (see README.txt).\n`);
});
