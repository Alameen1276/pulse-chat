/*
      /\   //  //
     /  \ //  //
    /    \\  //
   /______\ //
    AL-AMEEN
   CODE • BUILD • CREATE • IMPROVE
      @alameen.dev
*/
const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGODB_URI || '';
const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 15e6 }); // room for voice notes + photos

app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const GROUP = 'group';
const MAX_PER_CHAT = 200;

const users = new Map();    // userId -> { id, name, color, online, lastSeen }
const creds = new Map();    // userId -> { salt, hash }   (never sent to anyone)
const byName = new Map();   // lower-case name -> userId
const sessions = new Map(); // sha256(token) -> userId
const sockets = new Map();  // userId -> Set(socket.id)   (one user can have several tabs)
const chats = new Map();    // chatKey -> [messages]      ('group' or 'idA|idB')

const pairKey = (a, b) => [a, b].sort().join('|');
const roomOf = (id) => `u:${id}`;
const isOnline = (id) => (sockets.get(id)?.size || 0) > 0;
const publicUser = (u) => ({ id: u.id, name: u.name, color: u.color, online: u.online, lastSeen: u.lastSeen });
const userList = () => [...users.values()].map(publicUser);
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

/* ------------------------------------------------------------------
   Database (MongoDB Atlas). Without MONGODB_URI the app still runs,
   but everything is kept in memory and lost on restart.
------------------------------------------------------------------ */
const col = { users: null, sessions: null, messages: null };
const persist = (fn) => {
  if (!col.users) return;
  Promise.resolve().then(fn).catch((e) => console.error('Database error:', e.message));
};

async function initDb() {
  if (!MONGO_URI) {
    console.log('\n  WARNING: MONGODB_URI is not set. Accounts and messages are kept in memory only.\n');
    return;
  }
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const d = client.db(process.env.MONGODB_DB || 'pulse');
  col.users = d.collection('users');
  col.sessions = d.collection('sessions');
  col.messages = d.collection('messages');
  await col.users.createIndex({ nameLower: 1 }, { unique: true });
  await col.messages.createIndex({ key: 1, ts: 1 });

  for (const u of await col.users.find({}).toArray()) {
    users.set(u._id, { id: u._id, name: u.name, color: u.color, online: false, lastSeen: u.lastSeen || 0 });
    creds.set(u._id, { salt: u.salt, hash: u.hash });
    byName.set(u.nameLower, u._id);
  }
  for (const s of await col.sessions.find({}).toArray()) sessions.set(s._id, s.userId);

  for (const m of await col.messages.find({}).sort({ ts: 1 }).toArray()) {
    const { _id, key, ...msg } = m;
    msg.id = _id;
    if (!chats.has(key)) chats.set(key, []);
    chats.get(key).push(msg);
  }
  for (const list of chats.values()) while (list.length > MAX_PER_CHAT) list.shift();
  console.log(`  Database connected: ${users.size} account(s), ${[...chats.values()].reduce((n, l) => n + l.length, 0)} message(s) loaded`);
}

/* ------------------------------------------------------------------
   Accounts: sign up, log in, log out
------------------------------------------------------------------ */
const hashPw = (pw, salt) => new Promise((resolve, reject) =>
  crypto.scrypt(pw, salt, 64, (err, key) => (err ? reject(err) : resolve(key.toString('hex')))));

async function checkPw(pw, c) {
  if (!c) { await hashPw(pw, 'x'.repeat(16)); return false; } // same cost for unknown names
  const a = Buffer.from(await hashPw(pw, c.salt), 'hex');
  const b = Buffer.from(c.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function newSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const key = sha(token);
  sessions.set(key, userId);
  persist(() => col.sessions.insertOne({ _id: key, userId, createdAt: Date.now() }));
  return token;
}

// Very small brute-force guard: 12 tries per 10 minutes per IP
const tries = new Map();
function tooMany(ip) {
  const now = Date.now();
  let t = tries.get(ip);
  if (!t || now > t.reset) { t = { n: 0, reset: now + 10 * 60 * 1000 }; tries.set(ip, t); }
  return ++t.n > 12;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of tries) if (now > v.reset) tries.delete(k); }, 60 * 1000).unref();

const profileOf = (u, token) => ({ id: u.id, name: u.name, color: u.color, token });

app.post('/api/signup', async (req, res) => {
  try {
    if (tooMany(req.ip)) return res.status(429).json({ ok: false, error: 'Too many tries. Wait a few minutes and try again.' });
    const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ');
    const password = String(req.body?.password || '');
    const color = /^#[0-9a-f]{6}$/i.test(req.body?.color) ? req.body.color : '#1fa67a';
    if (name.length < 2 || name.length > 24) return res.status(400).json({ ok: false, error: 'Your name must be 2 to 24 characters.' });
    if (password.length < 6 || password.length > 100) return res.status(400).json({ ok: false, error: 'Your password must be at least 6 characters.' });
    const lower = name.toLowerCase();
    if (byName.has(lower)) return res.status(409).json({ ok: false, error: 'That name is already taken. Pick another, or log in.' });

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = await hashPw(password, salt);
    if (byName.has(lower)) return res.status(409).json({ ok: false, error: 'That name is already taken. Pick another, or log in.' });

    const id = crypto.randomUUID();
    const u = { id, name, color, online: false, lastSeen: Date.now() };
    users.set(id, u);
    creds.set(id, { salt, hash });
    byName.set(lower, id);
    persist(() => col.users.insertOne({ _id: id, name, nameLower: lower, color, salt, hash, lastSeen: u.lastSeen, createdAt: u.lastSeen }));
    const token = newSession(id);
    io.emit('users', userList());
    res.json({ ok: true, profile: profileOf(u, token) });
  } catch (e) {
    console.error('signup error:', e.message);
    res.status(500).json({ ok: false, error: 'Something went wrong. Try again.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    if (tooMany(req.ip)) return res.status(429).json({ ok: false, error: 'Too many tries. Wait a few minutes and try again.' });
    const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ');
    const password = String(req.body?.password || '');
    const id = byName.get(name.toLowerCase());
    const okPw = await checkPw(password, id ? creds.get(id) : null);
    if (!id || !okPw) return res.status(401).json({ ok: false, error: 'Wrong name or password.' });
    res.json({ ok: true, profile: profileOf(users.get(id), newSession(id)) });
  } catch (e) {
    console.error('login error:', e.message);
    res.status(500).json({ ok: false, error: 'Something went wrong. Try again.' });
  }
});

app.post('/api/logout', (req, res) => {
  const key = sha(req.body?.token || '');
  if (sessions.delete(key)) persist(() => col.sessions.deleteOne({ _id: key }));
  res.json({ ok: true });
});

/* ------------------------------------------------------------------
   Call relay (TURN). Needed so calls connect between different networks.
   Set METERED_APP_NAME and METERED_API_KEY in Render. Without them,
   Pulse falls back to free STUN only (calls work on the same network).
------------------------------------------------------------------ */
const STUN = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
let iceCache = { at: 0, servers: STUN };

app.get('/api/ice', async (req, res) => {
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!bearer || !sessions.has(sha(bearer))) return res.status(401).json({ ok: false });

  const appName = String(process.env.METERED_APP_NAME || '').trim().replace(/^https?:\/\//, '').replace(/\.metered\.live.*$/, '');
  const apiKey = String(process.env.METERED_API_KEY || '').trim();
  if (!appName || !apiKey) return res.json(STUN);
  if (Date.now() - iceCache.at < 10 * 60 * 1000) return res.json(iceCache.servers);

  try {
    const r = await fetch(`https://${encodeURIComponent(appName)}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const servers = await r.json();
    if (!Array.isArray(servers) || !servers.length) throw new Error('empty reply');
    iceCache = { at: Date.now(), servers };
    res.json(servers);
  } catch (e) {
    console.error('TURN lookup failed, using STUN only:', e.message);
    res.json(STUN);
  }
});

/* ------------------------------------------------------------------
   Chat
------------------------------------------------------------------ */
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
  const all = [];
  for (const [key, list] of chats) {
    if (key === GROUP || !key.split('|').includes(uid)) continue;
    for (const m of list) {
      if (m.to === uid && m.status === 'sent') {
        m.status = 'delivered';
        all.push(m.id);
        if (!bySender.has(m.from)) bySender.set(m.from, []);
        bySender.get(m.from).push(m.id);
      }
    }
  }
  if (all.length) persist(() => col.messages.updateMany({ _id: { $in: all } }, { $set: { status: 'delivered' } }));
  for (const [sender, ids] of bySender) {
    io.to(roomOf(sender)).emit('status', { chat: uid, ids, status: 'delivered' });
  }
}

io.on('connection', (socket) => {
  let me = null;

  socket.on('join', (p, ack) => {
    const id = String(p?.id || '');
    const token = String(p?.token || '');
    if (!token || sessions.get(sha(token)) !== id || !users.has(id)) {
      return ack?.({ ok: false, auth: true, error: 'Please log in again.' });
    }

    me = id;
    const u = users.get(id);
    u.online = true;
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
    persist(() => col.messages.insertOne({ ...msg, _id: msg.id, key }));
    if (list.length > MAX_PER_CHAT) {
      const old = list.shift();
      persist(() => col.messages.deleteOne({ _id: old.id }));
    }

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
    if (ids.length) {
      persist(() => col.messages.updateMany({ _id: { $in: ids } }, { $set: { status: 'read' } }));
      io.to(roomOf(chat)).emit('status', { chat: me, ids, status: 'read' });
    }
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
      if (u) {
        u.online = false;
        u.lastSeen = Date.now();
        persist(() => col.users.updateOne({ _id: me }, { $set: { lastSeen: u.lastSeen } }));
      }
      io.emit('users', userList());
    }
  });
});

initDb()
  .then(() => {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`\n  Pulse is running\n`);
      console.log(`  On this computer:  http://localhost:${PORT}`);
      for (const list of Object.values(os.networkInterfaces())) {
        for (const i of list || []) {
          if (i.family === 'IPv4' && !i.internal) console.log(`  On your Wi-Fi:     http://${i.address}:${PORT}`);
        }
      }
      console.log(`\n  Note: voice/video calls and voice notes need https or localhost.\n`);
    });
  })
  .catch((e) => {
    console.error('\n  Could not connect to the database:', e.message);
    console.error('  Check the MONGODB_URI value (password, and "Allow access from anywhere" in Atlas).\n');
    process.exit(1);
  });
