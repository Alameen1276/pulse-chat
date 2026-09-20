/* Shared helpers for both pages */
const COLORS = ['#14a06f', '#2f7de1', '#7c5cdb', '#d6478a', '#d97706', '#dc3f3f', '#0e91b8', '#5b6b7a'];

const ICONS = {
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  video: '<path d="m22 8-6 4 6 4V8z"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  videoOff: '<path d="M10.7 5H14a2 2 0 0 1 2 2v3.3l6 3.7V8l-6 3.7"/><path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2"/><path d="m2 2 20 20"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
  micOff: '<path d="m2 2 20 20"/><path d="M9 9v3a3 3 0 0 0 5.1 2.1"/><path d="M15 9.3V5a3 3 0 0 0-5.7-1.3"/><path d="M19 10v2a7 7 0 0 1-.7 3"/><path d="M5 10v2a7 7 0 0 0 11 5.7"/><path d="M12 19v3"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/>',
  back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3" fill="currentColor"/>',
  pause: '<rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checks: '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  bubble: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.6-.8L3 21l1.9-5.4A8.4 8.4 0 1 1 21 11.5z"/>',
};

function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'i');
  s.innerHTML = ICONS[name] || '';
  return s;
}

/* Tiny DOM builder. Text is always added as text (never HTML), so user input is safe. */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function initials(name) {
  const p = String(name || '?').trim().split(/\s+/);
  return ((p[0]?.[0] || '?') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

function avatarEl(user, size = 44, online = false) {
  const el = h('div', { class: 'avatar' + (user.group ? ' group' : ''), style: `--s:${size}px;` + (user.group ? '' : `background:${user.color}`) });
  if (user.group) el.append(icon('users'));
  else el.append(initials(user.name));
  if (online) el.append(h('span', { class: 'dot' }));
  return el;
}

/* Profile storage: "remember me" uses localStorage, otherwise sessionStorage */
const PROFILE_KEY = 'pulse.profile';
function getProfile() {
  for (const st of [localStorage, sessionStorage]) {
    try {
      const p = JSON.parse(st.getItem(PROFILE_KEY));
      if (p && p.id && p.name) return p;
    } catch (e) {}
  }
  return null;
}
function saveProfile(p, remember) {
  try { localStorage.removeItem(PROFILE_KEY); sessionStorage.removeItem(PROFILE_KEY); } catch (e) {}
  try { (remember ? localStorage : sessionStorage).setItem(PROFILE_KEY, JSON.stringify(p)); } catch (e) {}
}
function clearProfile() {
  try { localStorage.removeItem(PROFILE_KEY); sessionStorage.removeItem(PROFILE_KEY); } catch (e) {}
}

/* Theme */
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('pulse.theme', t); } catch (e) {}
}
function toast(msg, ms = 3800) {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) { wrap = h('div', { class: 'toast-wrap' }); document.body.append(wrap); }
  const t = h('div', { class: 'toast', text: msg });
  wrap.append(t);
  setTimeout(() => t.remove(), ms);
}
