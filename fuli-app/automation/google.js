const { exec } = require('child_process');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Google connector: Calendar, Gmail (read-only) and YouTube through one "Sign in with Google" login.
// Uses a Desktop-app OAuth client (PKCE + loopback redirect). Needs GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
const TOKEN_FILE = path.join(os.homedir(), '.fuli', 'google-token.json');
const REDIRECT_PORT = 8889;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}`;
const SCOPES = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/youtube.readonly'
].join(' ');

let auth = null;

function loadAuth() {
  if (auth) return auth;
  try { auth = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); } catch (e) { auth = null; }
  return auth;
}

function saveAuth(a) {
  auth = a;
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    if (a) fs.writeFileSync(TOKEN_FILE, JSON.stringify(a), { mode: 0o600 });
    else fs.unlinkSync(TOKEN_FILE);
  } catch (e) {}
}

const isConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const isConnected = () => !!loadAuth();

function status() {
  const a = loadAuth();
  return { configured: isConfigured(), connected: !!a, name: a && (a.name || a.email) };
}

async function tokenRequest(params) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, ...params }).toString()
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || `Google login failed (${res.status})`);
  return data;
}

async function getToken() {
  const a = loadAuth();
  if (!a) throw new Error('Connect Google first — click the plug icon next to the mic');
  if (Date.now() < a.expiresAt) return a.accessToken;
  try {
    const data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: a.refreshToken });
    saveAuth({ ...a, accessToken: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 });
    return auth.accessToken;
  } catch (e) {
    saveAuth(null);
    throw new Error('Google access expired or was revoked — connect Google again from the plug icon');
  }
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (!res.ok) {
    let msg = `Google API error (${res.status})`;
    try {
      const j = await res.json();
      msg = (j.error && (j.error.message || j.error)) || msg;
      if (res.status === 403 && /has not been used|disabled/i.test(String(msg))) msg = 'That Google API isn\'t switched on for your project yet — see the README (Google connector, step 2)';
    } catch (e) {}
    throw new Error(String(msg));
  }
  if (res.status === 204) return null; // e.g. DELETE succeeded, nothing to parse
  return res.json();
}

// ───────── Login ─────────
function connect() {
  if (!isConfigured()) return Promise.reject(new Error('Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your .env first — see the README'));
  const verifier = crypto.randomBytes(64).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(12).toString('hex');

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== '/') { res.writeHead(404); return res.end(); }
      const page = (title, body) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><title>Fuli</title><body style="font-family:-apple-system,sans-serif;background:#1c1c1e;color:#f4f4f6;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="font-weight:600">${title}</h1><p style="color:#9b9ba5">${body}</p></div>`);
      };
      const err = url.searchParams.get('error');
      if (err) { page('Not connected', 'You can close this tab and try again.'); cleanup(); return reject(new Error(err === 'access_denied' ? 'Google connection was cancelled' : err)); }
      if (url.searchParams.get('state') !== state) { res.writeHead(400); return res.end(); }
      try {
        const data = await tokenRequest({ grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: REDIRECT_URI, code_verifier: verifier });
        if (!data.refresh_token) throw new Error('Google did not return a long-lived login — remove Fuli at myaccount.google.com/permissions and try again');
        let name = '';
        try {
          const info = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${data.access_token}` } })).json();
          name = info.name || info.email || '';
        } catch (e) {}
        saveAuth({ accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000, name, scope: data.scope || '' });
        page('Fuli is connected to Google', 'You can close this tab and go back to Fuli.');
        cleanup();
        resolve({ name });
      } catch (e) { page('Something went wrong', e.message); cleanup(); reject(e); }
    });
    const timer = setTimeout(() => { cleanup(); reject(new Error('Google login timed out')); }, 180000);
    const cleanup = () => { clearTimeout(timer); server.close(); };
    server.on('error', (e) => { cleanup(); reject(new Error(`Couldn't listen on ${REDIRECT_URI}: ${e.message}`)); });
    server.listen(REDIRECT_PORT, '127.0.0.1', () => {
      const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code', scope: SCOPES,
        code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent'
      }).toString();
      exec(`open "${authUrl}"`);
    });
  });
}

async function disconnect() {
  const a = loadAuth();
  if (a && a.refreshToken) {
    fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(a.refreshToken)}`, { method: 'POST' }).catch(() => {});
  }
  saveAuth(null);
}

// ───────── Calendar ─────────
function dayBounds(range) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = 86400000;
  if (range === 'tomorrow') return { from: new Date(start.getTime() + day), to: new Date(start.getTime() + 2 * day), label: 'Tomorrow' };
  if (range === 'week') return { from: now, to: new Date(start.getTime() + 7 * day), label: 'Next 7 days' };
  return { from: now, to: new Date(start.getTime() + day), label: 'Today' };
}

function eventTime(ev) {
  if (ev.start.date) return 'All day';
  return new Date(ev.start.dateTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function eventDay(ev) {
  const d = new Date(ev.start.dateTime || ev.start.date + 'T00:00:00');
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

async function listEvents(range) {
  const { from, to, label } = range === 'next' ? { from: new Date(), to: new Date(Date.now() + 30 * 86400000), label: 'Next meeting' } : dayBounds(range);
  const params = new URLSearchParams({
    timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime',
    maxResults: range === 'next' ? '1' : '25'
  });
  const r = await api(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`);
  const events = (r.items || []).filter((e) => e.status !== 'cancelled').map((e) => ({
    id: e.id,
    title: e.summary || '(No title)',
    time: eventTime(e),
    day: eventDay(e),
    location: e.location || '',
    url: e.htmlLink
  }));
  return { label, range, events };
}

// Google's own natural-language parser: "Dinner with Sam tomorrow at 8pm"
async function quickAdd(text) {
  const ev = await api(`https://www.googleapis.com/calendar/v3/calendars/primary/events/quickAdd?${new URLSearchParams({ text })}`, { method: 'POST' });
  return { title: ev.summary || text, when: `${eventDay(ev)} · ${eventTime(ev)}`, url: ev.htmlLink };
}

// Find upcoming events matching words like "dinner with sam", "8pm meeting", "tomorrow's standup"
async function findEvents(text) {
  const now = new Date();
  const to = new Date(now.getTime() + 90 * 86400000);
  const r = await api(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${new URLSearchParams({
    timeMin: now.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '100' })}`);
  const all = (r.items || []).filter((e) => e.status !== 'cancelled');

  let q = text.toLowerCase();
  const dayWord = /\btoday\b/.test(q) ? 0 : /\btomorrow\b/.test(q) ? 1 : null;
  const t = q.match(/\b(\d{1,2})(?::(\d\d))?\s*(am|pm)\b/);
  q = q.replace(/\b(today|tomorrow|tonight|my|the|a|an|at|on|from|calendar|event|events|meeting|appointment)\b/g, ' ')
       .replace(/\b\d{1,2}(?::\d\d)?\s*(am|pm)\b/g, ' ').replace(/[^a-z0-9 ]/g, ' ');
  const words = q.split(/\s+/).filter(Boolean);

  const startOf = (e) => new Date(e.start.dateTime || e.start.date + 'T00:00:00');
  const scored = all.map((e) => {
    const d = startOf(e);
    let score = 0;
    const title = (e.summary || '').toLowerCase();
    for (const w of words) if (title.includes(w)) score += 2;
    if (words.length && score === 0) return { e, score: 0 };
    if (dayWord !== null) {
      const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayWord);
      if (d.toDateString() === target.toDateString()) score += 2; else score -= 3;
    }
    if (t && e.start.dateTime) {
      let h = parseInt(t[1], 10) % 12 + (t[3] === 'pm' ? 12 : 0);
      if (d.getHours() === h && d.getMinutes() === parseInt(t[2] || '0', 10)) score += 3; else score -= 2;
    }
    return { e, score };
  }).filter((x) => x.score > 0 || (!words.length && x.score >= 0 && (dayWord !== null || t)));

  scored.sort((a, b) => b.score - a.score || startOf(a.e) - startOf(b.e));
  return scored.slice(0, 5).map(({ e }) => ({ id: e.id, title: e.summary || '(No title)', when: `${eventDay(e)} · ${eventTime(e)}`, url: e.htmlLink }));
}

async function deleteEvent(id) {
  await api(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ───────── Gmail (read-only) ─────────
const header = (msg, name) => ((msg.payload.headers || []).find((h) => h.name.toLowerCase() === name) || {}).value || '';

function senderName(from) {
  const m = from.match(/^"?([^"<]+?)"?\s*<.*>$/);
  return (m ? m[1] : from).trim();
}

async function mailList(query, max = 10) {
  const list = await api(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ q: query, maxResults: String(max) })}`);
  const ids = (list.messages || []).map((m) => m.id);
  const msgs = await Promise.all(ids.map((id) =>
    api(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)));
  return msgs.map((m) => ({
    id: m.id,
    from: senderName(header(m, 'from')),
    subject: header(m, 'subject') || '(No subject)',
    ts: Number(m.internalDate),
    snippet: m.snippet || '',
    unread: (m.labelIds || []).includes('UNREAD'),
    url: `https://mail.google.com/mail/u/0/#inbox/${m.id}`
  }));
}

async function unreadMail(from) {
  const q = `is:unread in:inbox${from ? ` from:(${from.replace(/[()"]/g, '')})` : ''}`;
  return mailList(q, 10);
}

function decodeBody(payload) {
  const parts = [];
  (function walk(p) {
    if (!p) return;
    if (p.mimeType === 'text/plain' && p.body && p.body.data) parts.push(Buffer.from(p.body.data, 'base64url').toString('utf8'));
    (p.parts || []).forEach(walk);
  })(payload);
  return parts.join('\n').trim();
}

async function latestMail() {
  const list = await api(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ q: 'in:inbox', maxResults: '1' })}`);
  if (!(list.messages || []).length) throw new Error('Your inbox is empty');
  const m = await api(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${list.messages[0].id}?format=full`);
  const body = decodeBody(m.payload) || m.snippet || '';
  return {
    id: m.id, from: senderName(header(m, 'from')), subject: header(m, 'subject') || '(No subject)',
    ts: Number(m.internalDate), body: body.length > 1500 ? body.slice(0, 1500).trim() + '…' : body,
    url: `https://mail.google.com/mail/u/0/#inbox/${m.id}`
  };
}

// ───────── YouTube ─────────
async function searchVideo(query) {
  const r = await api(`https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({ part: 'snippet', type: 'video', maxResults: '1', q: query })}`);
  const v = (r.items || [])[0];
  if (!v) throw new Error(`No YouTube results for "${query}"`);
  return { id: v.id.videoId, title: v.snippet.title, channel: v.snippet.channelTitle, url: `https://www.youtube.com/watch?v=${v.id.videoId}` };
}

async function myPlaylists() {
  const r = await api(`https://www.googleapis.com/youtube/v3/playlists?${new URLSearchParams({ part: 'snippet,contentDetails', mine: 'true', maxResults: '50' })}`);
  return (r.items || []).map((p) => ({ id: p.id, title: p.snippet.title, count: p.contentDetails.itemCount, url: `https://www.youtube.com/playlist?list=${p.id}` }));
}

module.exports = {
  status, isConfigured, isConnected, connect, disconnect,
  listEvents, quickAdd, findEvents, deleteEvent, unreadMail, latestMail, searchVideo, myPlaylists
};
