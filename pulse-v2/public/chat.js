(() => {
  'use strict';

  const GROUP = 'group';
  const $ = (s) => document.querySelector(s);

  const me = getProfile();
  if (!me) { location.replace('index.html'); return; }

  document.querySelectorAll('[data-icon]').forEach((el) => el.prepend(icon(el.dataset.icon)));

  /* ------------------------------------------------------------------
     State
  ------------------------------------------------------------------ */
  const state = {
    users: new Map(),   // id -> user
    chats: {},          // key -> { last, unread }
    msgs: {},           // key -> [messages]  (loaded when a chat is opened)
    active: null,       // open chat key ('group' or a user id)
    typing: {},         // key -> Map(userId -> timeout)
    filter: '',
  };
  const socket = io();
  const isMobile = () => matchMedia('(max-width: 820px)').matches;
  const isTouch = () => matchMedia('(pointer: coarse)').matches;

  /* ------------------------------------------------------------------
     Formatting helpers
  ------------------------------------------------------------------ */
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.getTime(); };
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  function dayLabel(ts) {
    if (sameDay(ts, Date.now())) return 'Today';
    if (sameDay(ts, daysAgo(1))) return 'Yesterday';
    return new Date(ts).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  }
  function listTime(ts) {
    if (sameDay(ts, Date.now())) return fmtTime(ts);
    if (sameDay(ts, daysAgo(1))) return 'Yesterday';
    return new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short' });
  }
  function lastSeenText(ts) {
    if (!ts) return 'offline';
    if (sameDay(ts, Date.now())) return 'last seen today at ' + fmtTime(ts);
    if (sameDay(ts, daysAgo(1))) return 'last seen yesterday at ' + fmtTime(ts);
    return 'last seen ' + new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short' });
  }
  const nameOf = (id) => (id === GROUP ? 'Everyone' : state.users.get(id)?.name || 'Someone');
  const chatState = (key) => (state.chats[key] ||= { last: null, unread: 0 });
  const slim = (m) => ({ id: m.id, from: m.from, to: m.to, type: m.type, text: m.text, duration: m.duration, video: m.video, outcome: m.outcome, ts: m.ts });

  function previewText(m) {
    if (!m) return '';
    let who = '';
    if (m.from === me.id) who = 'You: ';
    else if (m.to === GROUP) who = nameOf(m.from).split(' ')[0] + ': ';
    let body;
    if (m.type === 'audio') body = '🎤 Voice message ' + mmss(m.duration || 0);
    else if (m.type === 'image') body = '📷 ' + (m.text || 'Photo');
    else if (m.type === 'call') { who = ''; body = (m.video ? '📹 Video call' : '📞 Voice call') + (m.outcome === 'ended' ? '' : m.from === me.id ? ' · No answer' : ' · Missed'); }
    else body = m.text || '';
    return who + body;
  }

  /* ------------------------------------------------------------------
     Sounds (generated, no audio files needed)
  ------------------------------------------------------------------ */
  let actx = null;
  const audioCtx = () => (actx ||= new (window.AudioContext || window.webkitAudioContext)());
  document.addEventListener('pointerdown', () => { try { audioCtx().resume(); } catch (e) {} }, { once: true, passive: true });

  function beep(freq, dur, when = 0, vol = 0.08) {
    try {
      const c = audioCtx();
      const t = c.currentTime + when;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(c.destination);
      o.start(t);
      o.stop(t + dur + 0.05);
    } catch (e) {}
  }
  const blip = () => { beep(880, 0.12, 0, 0.05); beep(1175, 0.16, 0.1, 0.05); };

  let ringTimer = null;
  function startRing(kind) {
    stopRing();
    const play = () => {
      if (kind === 'in') { beep(880, 0.22); beep(660, 0.22, 0.27); beep(880, 0.22, 0.54); beep(660, 0.22, 0.81); }
      else beep(440, 0.9, 0, 0.05);
    };
    play();
    ringTimer = setInterval(play, kind === 'in' ? 2400 : 3000);
  }
  function stopRing() { clearInterval(ringTimer); ringTimer = null; }

  /* ------------------------------------------------------------------
     Sidebar
  ------------------------------------------------------------------ */
  function isTyping(key) { return (state.typing[key]?.size || 0) > 0; }
  function typingText(key) {
    if (key !== GROUP) return 'typing…';
    return [...state.typing[key].keys()].map((id) => nameOf(id).split(' ')[0]).join(', ') + ' typing…';
  }

  function rowEl(u) {
    const c = state.chats[u.id] || {};
    const typing = isTyping(u.id);
    let prev = previewText(c.last);
    if (!prev) prev = u.group ? 'Chat with everyone here' : u.online ? 'Online' : lastSeenText(u.lastSeen);
    return h('button', {
      class: 'row' + (state.active === u.id ? ' active' : '') + (c.unread ? ' unread' : ''),
      onclick: () => openChat(u.id),
    },
      avatarEl(u, 48, !u.group && u.online),
      h('div', { class: 'mid' },
        h('div', { class: 'top' }, h('b', { text: u.name }), c.last ? h('time', { text: listTime(c.last.ts) }) : null),
        h('div', { class: 'bot' },
          h('span', { class: 'prev' + (typing ? ' typing' : ''), text: typing ? typingText(u.id) : prev }),
          c.unread ? h('span', { class: 'badge', text: c.unread > 99 ? '99+' : String(c.unread) }) : null
        )
      )
    );
  }

  function renderList() {
    const list = $('#list');
    const q = state.filter.trim().toLowerCase();
    const people = [...state.users.values()].filter((u) => u.id !== me.id && (!q || u.name.toLowerCase().includes(q)));
    people.sort((a, b) =>
      (state.chats[b.id]?.last?.ts || 0) - (state.chats[a.id]?.last?.ts || 0) ||
      Number(b.online) - Number(a.online) ||
      a.name.localeCompare(b.name));

    list.replaceChildren();
    if (!q || 'everyone'.includes(q)) list.append(rowEl({ id: GROUP, name: 'Everyone', group: true }));
    if (people.length) {
      list.append(h('div', { class: 'sect', text: 'People' }));
      people.forEach((u) => list.append(rowEl(u)));
    } else if (q) {
      list.append(h('div', { class: 'list-empty', text: `No one matches "${state.filter.trim()}".` }));
    } else {
      list.append(h('div', { class: 'list-empty', text: 'No one else is here yet. Open Pulse in another browser or share the link with a friend.' }));
    }
    const total = Object.values(state.chats).reduce((n, c) => n + (c.unread || 0), 0);
    document.title = (total ? `(${total}) ` : '') + 'Pulse';
  }

  /* ------------------------------------------------------------------
     Chat header + messages
  ------------------------------------------------------------------ */
  function activeUser() {
    return state.active === GROUP ? { id: GROUP, name: 'Everyone', group: true } : state.users.get(state.active);
  }

  function renderHeader() {
    const key = state.active;
    const u = activeUser();
    if (!u) return;
    $('#headAv').replaceChildren(avatarEl(u, 42));
    $('#headName').textContent = u.name;
    const sub = $('#headSub');
    sub.className = '';
    if (isTyping(key)) { sub.textContent = typingText(key); sub.className = 'live'; }
    else if (key === GROUP) sub.textContent = [...state.users.values()].filter((x) => x.online).length + ' online';
    else if (u.online) { sub.textContent = 'online'; sub.className = 'live'; }
    else sub.textContent = lastSeenText(u.lastSeen);
    $('#voiceCallBtn').classList.toggle('hidden', key === GROUP);
    $('#videoCallBtn').classList.toggle('hidden', key === GROUP);
  }

  const ticksEl = (status) => h('span', { class: 'ticks', 'data-s': status }, icon(status === 'sent' ? 'check' : 'checks'));

  let currentAudio = null;
  function audioEl(m) {
    const audio = new Audio(m.audio);
    const dur = m.duration || 0;
    const N = 30;
    const btn = h('button', { class: 'play', 'aria-label': 'Play voice message' }, icon('play'));
    const wave = h('div', { class: 'wave' });
    let seed = 0;
    for (const ch of m.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    for (let i = 0; i < N; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      wave.append(h('i', { style: `height:${25 + (seed % 75)}%` }));
    }
    const time = h('span', { class: 'dur', text: mmss(dur) });
    const paint = () => {
      const p = dur ? Math.min(audio.currentTime / dur, 1) : 0;
      [...wave.children].forEach((b, i) => b.classList.toggle('on', i / N < p));
    };
    btn.onclick = () => {
      if (audio.paused) {
        if (currentAudio && currentAudio !== audio) currentAudio.pause();
        currentAudio = audio;
        audio.play().catch(() => toast('Could not play this voice message.'));
      } else audio.pause();
    };
    audio.addEventListener('play', () => btn.replaceChildren(icon('pause')));
    audio.addEventListener('pause', () => btn.replaceChildren(icon('play')));
    audio.addEventListener('timeupdate', () => { paint(); time.textContent = mmss(audio.currentTime); });
    audio.addEventListener('ended', () => { audio.currentTime = 0; btn.replaceChildren(icon('play')); paint(); time.textContent = mmss(dur); });
    return h('div', { class: 'voice' }, btn, wave, time);
  }

  function callEl(m) {
    const mine = m.from === me.id;
    const kind = m.video ? 'video call' : 'voice call';
    let title, sub, missed = false;
    if (m.outcome === 'ended') { title = (mine ? 'Outgoing ' : 'Incoming ') + kind; sub = mmss(m.duration || 0); }
    else if (mine) { title = kind[0].toUpperCase() + kind.slice(1); sub = m.outcome === 'declined' ? 'Declined' : 'No answer'; }
    else if (m.outcome === 'declined') { title = 'Declined ' + kind; sub = 'You declined'; }
    else { title = 'Missed ' + kind; sub = 'You missed this call'; missed = true; }
    return h('div', { class: 'callmsg' + (missed ? ' missed' : ''), 'data-id': m.id },
      h('span', { class: 'ci' }, icon(m.video ? 'video' : 'phone')),
      h('div', {}, h('b', { text: title }), h('small', { text: `${sub} · ${fmtTime(m.ts)}` }))
    );
  }

  function msgEl(m) {
    if (m.type === 'call') return callEl(m);
    const mine = m.from === me.id;
    const isGroup = m.to === GROUP;
    const media = m.type === 'image' ? ' img has-media' : m.type === 'audio' ? ' has-media' : '';
    const b = h('div', { class: 'bubble ' + (mine ? 'out' : 'in') + media, 'data-id': m.id });

    if (isGroup && !mine) {
      const s = state.users.get(m.from);
      b.append(h('div', { class: 'sender', style: `color:${s?.color || 'inherit'}`, text: s?.name || 'Someone' }));
    }
    if (m.type === 'image') {
      b.append(h('img', { class: 'photo', src: m.image, alt: 'Photo', onclick: () => openLightbox(m.image) }));
      if (m.text) b.append(h('div', { class: 'text', text: m.text }));
    } else if (m.type === 'audio') {
      b.append(audioEl(m));
    } else {
      b.append(h('div', { class: 'text', text: m.text }));
    }
    const meta = h('span', { class: 'meta' }, fmtTime(m.ts));
    if (mine && !isGroup) meta.append(ticksEl(m.status));
    b.append(meta);
    return b;
  }

  function appendMsgEl(box, m, prev) {
    if (!prev || !sameDay(prev.ts, m.ts)) box.append(h('div', { class: 'day', text: dayLabel(m.ts) }));
    box.append(msgEl(m));
  }

  function renderMessages() {
    const box = $('#messages');
    box.replaceChildren();
    let prev = null;
    for (const m of state.msgs[state.active] || []) { appendMsgEl(box, m, prev); prev = m; }
    box.scrollTop = box.scrollHeight;
  }

  function openLightbox(src) {
    const box = h('div', { class: 'lightbox', onclick: () => box.remove() }, h('img', { src, alt: 'Photo' }));
    document.body.append(box);
  }

  /* ------------------------------------------------------------------
     Open / close a chat
  ------------------------------------------------------------------ */
  function markRead(key) {
    if (!key) return;
    chatState(key).unread = 0;
    if (key !== GROUP && document.visibilityState === 'visible') socket.emit('read', { chat: key });
    renderList();
  }

  async function loadHistory(key) {
    const msgs = await new Promise((res) => socket.emit('history', { chat: key }, res));
    if (state.active !== key) return;
    state.msgs[key] = msgs || [];
    renderMessages();
    markRead(key);
  }

  function openChat(key) {
    if (key !== GROUP && !state.users.has(key)) return;
    stopTyping();
    state.active = key;
    document.body.classList.add('chat-open');
    $('#empty').classList.add('hidden');
    $('#chat').classList.remove('hidden');
    $('#messages').replaceChildren();
    $('#emojiPop').classList.add('hidden');
    renderHeader();
    renderList();
    loadHistory(key);
    if (!isMobile()) $('#input').focus();
  }

  function closeChat() {
    stopTyping();
    state.active = null;
    document.body.classList.remove('chat-open');
    $('#chat').classList.add('hidden');
    $('#empty').classList.remove('hidden');
    renderList();
  }

  /* ------------------------------------------------------------------
     Composer: text, emoji, photos
  ------------------------------------------------------------------ */
  const input = $('#input');
  let typingOn = false;
  let typingTimer = null;

  function notifyTyping() {
    if (!state.active) return;
    if (!typingOn) { typingOn = true; socket.emit('typing', { to: state.active, typing: true }); }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(stopTyping, 1800);
  }
  function stopTyping() {
    clearTimeout(typingTimer);
    if (typingOn && state.active) socket.emit('typing', { to: state.active, typing: false });
    typingOn = false;
  }

  function syncButtons() {
    const has = input.value.trim().length > 0;
    $('#sendBtn').classList.toggle('hidden', !has);
    $('#micBtn').classList.toggle('hidden', has);
  }
  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 130) + 'px';
  }

  function sendText() {
    const text = input.value.trim();
    if (!text || !state.active) return;
    socket.emit('message', { to: state.active, type: 'text', text });
    input.value = '';
    autoGrow();
    syncButtons();
    stopTyping();
    input.focus();
  }

  input.addEventListener('input', () => { autoGrow(); syncButtons(); notifyTyping(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isTouch()) { e.preventDefault(); sendText(); }
  });
  $('#sendBtn').onclick = sendText;

  // Emoji
  const pop = $('#emojiPop');
  Array.from('😀😃😄😁😆😅😂🤣😊😇🙂😉😍🥰😘😋😎🤩🥳😏😢😭😤😡🤔🙄😴🤗🤝👍👎👏🙌🙏💪🔥✨🎉💖💚💙💔💯✅❌👀🎧📷').forEach((e) => {
    pop.append(h('button', {
      type: 'button', text: e, 'aria-label': e,
      onclick: () => {
        const s = input.selectionStart ?? input.value.length;
        const t = input.selectionEnd ?? s;
        input.setRangeText(e, s, t, 'end');
        input.focus();
        syncButtons();
      },
    }));
  });
  $('#emojiBtn').onclick = (e) => { e.stopPropagation(); pop.classList.toggle('hidden'); };
  document.addEventListener('click', (e) => { if (!pop.contains(e.target)) pop.classList.add('hidden'); });

  // Photos
  function readImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const r = Math.min(1, 1280 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * r);
        c.height = Math.round(img.height * r);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
      img.src = url;
    });
  }
  $('#photoBtn').onclick = () => $('#photoInput').click();
  $('#photoInput').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !state.active) return;
    try {
      const data = await readImage(file);
      socket.emit('message', { to: state.active, type: 'image', image: data, text: input.value.trim() });
      input.value = '';
      autoGrow();
      syncButtons();
    } catch (err) {
      toast('That file could not be opened as a photo.');
    }
  };

  /* ------------------------------------------------------------------
     Voice notes
  ------------------------------------------------------------------ */
  let rec = null;
  const blobToDataURL = (blob) => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });

  async function startRecording() {
    if (rec || !state.active) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      return toast('Voice messages need https or localhost. See README.txt for a quick way to test on your phone.', 6500);
    }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { return toast('Allow microphone access to record a voice message.'); }

    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t));
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    const r = { mr, to: state.active, start: Date.now(), send: false, timer: null };
    rec = r;

    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = async () => {
      clearInterval(r.timer);
      stream.getTracks().forEach((t) => t.stop());
      $('#composer').classList.remove('recording');
      rec = null;
      if (!r.send) return;
      const seconds = (Date.now() - r.start) / 1000;
      if (seconds < 0.8) return toast('Recording was too short.');
      const data = await blobToDataURL(new Blob(chunks, { type: mr.mimeType || 'audio/webm' }));
      socket.emit('message', { to: r.to, type: 'audio', audio: data, duration: Math.round(seconds) });
    };

    mr.start();
    $('#composer').classList.add('recording');
    $('#recTime').textContent = '0:00';
    r.timer = setInterval(() => {
      const s = (Date.now() - r.start) / 1000;
      $('#recTime').textContent = mmss(s);
      if (s >= 180) stopRecording(true);
    }, 250);
  }
  function stopRecording(send) {
    if (!rec) return;
    rec.send = send;
    if (rec.mr.state !== 'inactive') rec.mr.stop();
  }
  $('#micBtn').onclick = startRecording;
  $('#recCancel').onclick = () => stopRecording(false);
  $('#recSend').onclick = () => stopRecording(true);

  /* ------------------------------------------------------------------
     Calls (WebRTC; the socket only carries the handshake)
  ------------------------------------------------------------------ */
  const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
  let call = null;      // the call in progress (or ringing out)
  let incoming = null;  // an offer waiting for accept / decline

  async function getMedia(video) {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast('Calls need https or localhost. See README.txt for a quick way to test on your phone.', 6500);
      return null;
    }
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: video ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false,
      });
    } catch (e) {
      toast(video ? 'Allow camera and microphone access to make a video call.' : 'Allow microphone access to make a call.');
      return null;
    }
  }

  const setCallStatus = (t) => { $('#callStatus').textContent = t; };

  function showCallUI(status) {
    const peer = state.users.get(call.peer);
    const el = $('#call');
    el.classList.remove('hidden', 'video-on');
    el.classList.toggle('voice-only', !call.video);
    $('#callAv').replaceChildren(avatarEl(peer, 140));
    $('#callAv').classList.add('ringing');
    $('#callName').textContent = peer.name;
    $('#camBtn').classList.toggle('hidden', !call.video);
    $('#muteBtn').classList.remove('off');
    $('#muteBtn').replaceChildren(icon('mic'));
    $('#camBtn').classList.remove('off');
    $('#camBtn').replaceChildren(icon('video'));
    $('#localVideo').srcObject = call.video ? call.local : null;
    setCallStatus(status);
  }

  function buildPeer() {
    const c = call;
    const pc = new RTCPeerConnection(ICE);
    c.pc = pc;
    c.local.getTracks().forEach((t) => pc.addTrack(t, c.local));
    pc.onicecandidate = (e) => {
      if (e.candidate && call === c) socket.emit('call:ice', { to: c.peer, candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      const rv = $('#remoteVideo');
      if (rv.srcObject !== e.streams[0]) rv.srcObject = e.streams[0];
    };
    pc.onconnectionstatechange = () => {
      if (call !== c) return;
      if (pc.connectionState === 'connected') onConnected();
      else if (pc.connectionState === 'disconnected') setCallStatus('Reconnecting…');
      else if (pc.connectionState === 'failed') {
        toast('The call could not connect. Your networks may be blocking a direct connection.', 6000);
        endCall(true, 'missed');
      }
    };
  }

  function onConnected() {
    if (!call || call.connected) return;
    call.connected = true;
    call.startedAt = Date.now();
    stopRing();
    $('#callAv').classList.remove('ringing');
    if (call.video) $('#call').classList.add('video-on');
    setCallStatus('0:00');
    call.timer = setInterval(() => setCallStatus(mmss((Date.now() - call.startedAt) / 1000)), 500);
  }

  async function flushCandidates() {
    if (!call?.pc?.remoteDescription) return;
    for (const c of call.candidates.splice(0)) {
      try { await call.pc.addIceCandidate(c); } catch (e) {}
    }
  }

  async function startCall(peerId, video) {
    if (call || incoming) return toast('You are already in a call.');
    const peer = state.users.get(peerId);
    if (!peer?.online) return toast(`${peer?.name || 'This person'} is offline.`);
    const local = await getMedia(video);
    if (!local) return;
    call = { peer: peerId, video, local, role: 'caller', candidates: [], connected: false };
    buildPeer();
    showCallUI('Calling…');
    startRing('out');
    try {
      const offer = await call.pc.createOffer();
      await call.pc.setLocalDescription(offer);
      socket.emit('call:offer', { to: peerId, offer: { type: offer.type, sdp: offer.sdp }, video });
    } catch (e) {
      console.error(e);
      toast('Could not start the call.');
      endCall(false, null);
    }
  }

  function showIncoming() {
    const peer = state.users.get(incoming.from);
    $('#incAv').replaceChildren(avatarEl(peer, 54));
    $('#incName').textContent = peer.name;
    $('#incKind').textContent = incoming.video ? 'Incoming video call' : 'Incoming voice call';
    $('#incoming').classList.remove('hidden');
    startRing('in');
    navigator.vibrate?.([300, 150, 300, 150, 300]);
  }
  function dismissIncoming() {
    stopRing();
    $('#incoming').classList.add('hidden');
    if (incoming) { incoming.cancelled = true; incoming = null; }
  }

  async function acceptIncoming() {
    const inc = incoming;
    if (!inc) return;
    stopRing();
    $('#incoming').classList.add('hidden');
    const local = await getMedia(inc.video);
    if (inc.cancelled) { local?.getTracks().forEach((t) => t.stop()); return; }
    incoming = null;
    if (!local) { socket.emit('call:decline', { to: inc.from }); return; }
    call = { peer: inc.from, video: inc.video, local, role: 'callee', candidates: inc.candidates, connected: false };
    buildPeer();
    showCallUI('Connecting…');
    try {
      await call.pc.setRemoteDescription(inc.offer);
      await flushCandidates();
      const answer = await call.pc.createAnswer();
      await call.pc.setLocalDescription(answer);
      socket.emit('call:answer', { to: inc.from, answer: { type: answer.type, sdp: answer.sdp } });
    } catch (e) {
      console.error(e);
      toast('Could not join the call.');
      endCall(true, null);
    }
  }

  function declineIncoming() {
    if (!incoming) return;
    socket.emit('call:decline', { to: incoming.from });
    dismissIncoming();
  }

  function endCall(notify, outcome) {
    const c = call;
    if (!c) return;
    call = null;
    if (notify) socket.emit('call:end', { to: c.peer });
    const duration = c.connected ? Math.round((Date.now() - c.startedAt) / 1000) : 0;
    // Only the caller writes the call entry, so it shows up once for both people
    if (c.role === 'caller' && (c.connected || outcome)) {
      socket.emit('message', { to: c.peer, type: 'call', video: c.video, duration, outcome: c.connected ? 'ended' : outcome });
    }
    stopRing();
    clearInterval(c.timer);
    c.local.getTracks().forEach((t) => t.stop());
    try { c.pc?.close(); } catch (e) {}
    $('#remoteVideo').srcObject = null;
    $('#localVideo').srcObject = null;
    $('#call').classList.add('hidden');
  }

  $('#endBtn').onclick = () => endCall(true, 'missed');
  $('#acceptBtn').onclick = acceptIncoming;
  $('#declineBtn').onclick = declineIncoming;
  $('#voiceCallBtn').onclick = () => startCall(state.active, false);
  $('#videoCallBtn').onclick = () => startCall(state.active, true);

  $('#muteBtn').onclick = () => {
    const t = call?.local.getAudioTracks()[0];
    if (!t) return;
    t.enabled = !t.enabled;
    $('#muteBtn').classList.toggle('off', !t.enabled);
    $('#muteBtn').replaceChildren(icon(t.enabled ? 'mic' : 'micOff'));
  };
  $('#camBtn').onclick = () => {
    const t = call?.local.getVideoTracks()[0];
    if (!t) return;
    t.enabled = !t.enabled;
    $('#camBtn').classList.toggle('off', !t.enabled);
    $('#camBtn').replaceChildren(icon(t.enabled ? 'video' : 'videoOff'));
  };

  socket.on('call:offer', ({ from, offer, video }) => {
    if (call || incoming) return socket.emit('call:busy', { to: from });
    incoming = { from, offer, video, candidates: [], cancelled: false };
    showIncoming();
  });
  socket.on('call:answer', async ({ from, answer }) => {
    if (!call || call.peer !== from || call.role !== 'caller') return;
    stopRing();
    setCallStatus('Connecting…');
    try {
      await call.pc.setRemoteDescription(answer);
      await flushCandidates();
    } catch (e) {
      console.error(e);
      toast('The call could not be set up.');
      endCall(true, 'missed');
    }
  });
  socket.on('call:ice', async ({ from, candidate }) => {
    if (call && call.peer === from) { call.candidates.push(candidate); await flushCandidates(); }
    else if (incoming && incoming.from === from) incoming.candidates.push(candidate);
  });
  socket.on('call:end', ({ from }) => {
    if (call && call.peer === from) endCall(false, 'missed');
    else if (incoming && incoming.from === from) dismissIncoming();
  });
  socket.on('call:decline', ({ from }) => {
    if (call && call.peer === from) { toast(`${nameOf(from)} declined the call.`); endCall(false, 'declined'); }
  });
  socket.on('call:busy', ({ from }) => {
    if (call && call.peer === from) { toast(`${nameOf(from)} is on another call.`); endCall(false, 'missed'); }
  });
  socket.on('call:unavailable', ({ from }) => {
    if (call && call.peer === from) { toast(`${nameOf(from)} is offline.`); endCall(false, null); }
  });
  window.addEventListener('beforeunload', () => { if (call) socket.emit('call:end', { to: call.peer }); });

  /* ------------------------------------------------------------------
     Socket events
  ------------------------------------------------------------------ */
  const setConn = (ok) => {
    const s = $('#meStatus');
    s.textContent = ok ? 'Online' : 'Reconnecting…';
    s.style.color = ok ? '' : 'var(--danger)';
  };

  socket.on('connect', () => {
    socket.emit('join', me, (res) => {
      if (!res?.ok) { toast(res?.error || 'Could not join. Go back and check your name.'); return; }
      setConn(true);
      state.users = new Map(res.users.map((u) => [u.id, u]));
      for (const [k, v] of Object.entries(res.summary)) state.chats[k] = v;
      renderList();
      if (state.active) { renderHeader(); loadHistory(state.active); }
    });
  });
  socket.on('disconnect', () => setConn(false));

  socket.on('users', (list) => {
    state.users = new Map(list.map((u) => [u.id, u]));
    renderList();
    if (state.active) renderHeader();
  });

  socket.on('message', (m) => {
    const mine = m.from === me.id;
    const key = m.to === GROUP ? GROUP : mine ? m.to : m.from;
    const cs = chatState(key);
    cs.last = slim(m);

    const isActive = state.active === key;
    const visible = document.visibilityState === 'visible';

    if (state.msgs[key]) {
      const list = state.msgs[key];
      const prev = list[list.length - 1];
      list.push(m);
      if (isActive) {
        const box = $('#messages');
        const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
        appendMsgEl(box, m, prev);
        if (mine || nearBottom) box.scrollTop = box.scrollHeight;
      }
    }
    if (!mine) {
      if (isActive && visible) { if (key !== GROUP) socket.emit('read', { chat: key }); }
      else { cs.unread++; blip(); }
    }
    renderList();
  });

  socket.on('status', ({ chat, ids, status }) => {
    const set = new Set(ids);
    state.msgs[chat]?.forEach((m) => { if (set.has(m.id)) m.status = status; });
    if (state.active === chat) {
      ids.forEach((id) => {
        const t = document.querySelector(`.bubble[data-id="${id}"] .ticks`);
        if (t) t.replaceWith(ticksEl(status));
      });
    }
  });

  socket.on('typing', ({ chat, from, typing }) => {
    if (from === me.id) return;
    const map = (state.typing[chat] ||= new Map());
    clearTimeout(map.get(from));
    if (typing) map.set(from, setTimeout(() => { map.delete(from); refreshTyping(chat); }, 4000));
    else map.delete(from);
    refreshTyping(chat);
  });
  function refreshTyping(chat) {
    renderList();
    if (state.active === chat) renderHeader();
  }

  /* ------------------------------------------------------------------
     Page chrome
  ------------------------------------------------------------------ */
  $('#meAv').append(avatarEl(me, 42));
  $('#meName').textContent = me.name;

  const themeBtn = $('#themeBtn');
  const paintTheme = () => themeBtn.replaceChildren(icon(currentTheme() === 'dark' ? 'sun' : 'moon'));
  themeBtn.onclick = () => { setTheme(currentTheme() === 'dark' ? 'light' : 'dark'); paintTheme(); };
  paintTheme();

  $('#logoutBtn').onclick = () => {
    if (call) endCall(true, 'missed');
    clearProfile();
    socket.disconnect();
    location.href = 'index.html';
  };
  $('#q').addEventListener('input', (e) => { state.filter = e.target.value; renderList(); });
  $('#backBtn').onclick = closeChat;

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const lb = document.querySelector('.lightbox');
    if (lb) lb.remove();
    else if (!pop.classList.contains('hidden')) pop.classList.add('hidden');
    else if (state.active && !call && !rec) closeChat();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.active) markRead(state.active);
  });

  renderList();
})();
