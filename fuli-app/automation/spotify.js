const { exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const isMac = process.platform === 'darwin';

// Spotify Web API (client-credentials flow) is used only for search, cover art and track lists.
// Playback itself is driven through the Spotify desktop app via AppleScript.
let token = null;
let tokenExpiry = 0;

function isInstalled() {
  if (!isMac) return false;
  return ['/Applications/Spotify.app', path.join(os.homedir(), 'Applications/Spotify.app')].some((p) => fs.existsSync(p));
}

async function getToken() {
  if (token && Date.now() < tokenExpiry) return token;
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error('Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to your .env (free at developer.spotify.com/dashboard)');
  }
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64')
    },
    body: 'grant_type=client_credentials'
  });
  if (!res.ok) throw new Error(`Spotify auth failed (${res.status}) — check your Spotify client ID/secret`);
  const data = await res.json();
  token = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return token;
}

// ───────── "Log in with Spotify" (Authorization Code + PKCE) ─────────
const TOKEN_FILE = path.join(os.homedir(), '.fuli', 'spotify-token.json');
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:8888';
const SCOPES = 'playlist-read-private playlist-read-collaborative user-library-read streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state';
let userAuth = null;

function loadUserAuth() {
  if (userAuth) return userAuth;
  try { userAuth = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); } catch (e) { userAuth = null; }
  return userAuth;
}

function saveUserAuth(auth) {
  userAuth = auth;
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(auth), { mode: 0o600 });
  } catch (e) {}
}

function isConnected() { return !!loadUserAuth(); }

async function tokenRequest(params) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.SPOTIFY_CLIENT_ID, ...params }).toString()
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || `Spotify login failed (${res.status})`);
  return data;
}

async function getUserToken() {
  const auth = loadUserAuth();
  if (!auth) return null;
  if (Date.now() < auth.expiresAt) return auth.accessToken;
  try {
    const data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: auth.refreshToken });
    saveUserAuth({ ...auth, accessToken: data.access_token, refreshToken: data.refresh_token || auth.refreshToken, expiresAt: Date.now() + (data.expires_in - 60) * 1000 });
    return userAuth.accessToken;
  } catch (e) {
    saveUserAuth(null);
    try { fs.unlinkSync(TOKEN_FILE); } catch (err) {}
    return null; // access revoked — fall back to public search
  }
}

// Opens Spotify's consent page in the browser and waits for the redirect back to a local port.
function connect() {
  if (!process.env.SPOTIFY_CLIENT_ID) return Promise.reject(new Error('Add SPOTIFY_CLIENT_ID to your .env first'));
  const verifier = crypto.randomBytes(64).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(12).toString('hex');
  const redirect = new URL(REDIRECT_URI);

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.searchParams.get('state') !== state && !url.searchParams.get('error')) { res.writeHead(404); return res.end(); }
      const page = (title, body) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><title>Fuli</title><body style="font-family:-apple-system,sans-serif;background:#1c1c1e;color:#f4f4f6;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="font-weight:600">${title}</h1><p style="color:#9b9ba5">${body}</p></div>`);
      };
      const err = url.searchParams.get('error');
      if (err) { page('Not connected', 'You can close this tab and try again.'); cleanup(); return reject(new Error(err === 'access_denied' ? 'Spotify connection was cancelled' : err)); }
      try {
        const data = await tokenRequest({ grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: REDIRECT_URI, code_verifier: verifier });
        saveUserAuth({ accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000, scope: data.scope || '' });
        let name = 'Spotify';
        try { name = (await api('/me')).display_name || name; } catch (e) {}
        saveUserAuth({ ...userAuth, name });
        page('Fuli is connected to Spotify', 'You can close this tab and go back to Fuli.');
        cleanup();
        resolve({ name });
      } catch (e) { page('Something went wrong', e.message); cleanup(); reject(e); }
    });
    const timer = setTimeout(() => { cleanup(); reject(new Error('Spotify login timed out')); }, 180000);
    const cleanup = () => { clearTimeout(timer); server.close(); };
    server.on('error', (e) => { cleanup(); reject(new Error(`Couldn't listen on ${REDIRECT_URI}: ${e.message}`)); });
    server.listen(parseInt(redirect.port, 10) || 80, redirect.hostname, () => {
      const authUrl = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
        client_id: process.env.SPOTIFY_CLIENT_ID, response_type: 'code', redirect_uri: REDIRECT_URI,
        scope: SCOPES, code_challenge_method: 'S256', code_challenge: challenge, state
      }).toString();
      exec(`open "${authUrl}"`);
    });
  });
}

// In-app playback needs the 'streaming' permission; logins from before it was requested must reconnect once.
function canStream() {
  const auth = loadUserAuth();
  return !!(auth && (auth.scope || '').split(' ').includes('streaming'));
}

function status() {
  const auth = loadUserAuth();
  return { installed: isInstalled(), connected: !!auth, name: auth && auth.name, needsReconnect: !!auth && !canStream(), inApp: !!(engine && engine.available()) };
}

function disconnect() {
  userAuth = null;
  try { fs.unlinkSync(TOKEN_FILE); } catch (e) {}
}

async function api(endpoint) {
  const user = await getUserToken();
  const res = await fetch(`https://api.spotify.com/v1${endpoint}`, {
    headers: { Authorization: `Bearer ${user || (await getToken())}` }
  });
  if (!res.ok) throw new Error(`Spotify API error (${res.status})`);
  return res.json();
}

const bestImage = (images) => (images && images.length ? images[0].url : null);
const artistNames = (artists) => (artists || []).map((a) => a.name).join(', ');

function mapTrack(t, fallbackCover) {
  return {
    uri: t.uri,
    name: t.name,
    artist: artistNames(t.artists),
    durationMs: t.duration_ms,
    cover: bestImage(t.album && t.album.images) || fallbackCover
  };
}

async function albumDetails(albumId) {
  const a = await api(`/albums/${albumId}`);
  const cover = bestImage(a.images);
  return {
    kind: 'album',
    contextUri: a.uri,
    title: a.name,
    subtitle: `${artistNames(a.artists)} · ${(a.release_date || '').slice(0, 4)}`,
    cover,
    tracks: a.tracks.items.map((t) => mapTrack(t, cover))
  };
}

async function playlistDetails(playlistId) {
  const p = await api(`/playlists/${playlistId}?fields=name,uri,images,owner(display_name)`);
  const cover = bestImage(p.images);
  const out = { kind: 'playlist', contextUri: p.uri, title: p.name, subtitle: `Playlist · ${p.owner ? p.owner.display_name : 'Spotify'}`, cover, tracks: [] };
  if (!isConnected()) return { ...out, noTracklist: true };
  try {
    const r = await api(`/playlists/${playlistId}/items?limit=100`);
    const tracks = (r.items || []).map((i) => i && (i.track || i.item)).filter((t) => t && t.uri && t.uri.startsWith('spotify:track:')).map((t) => mapTrack(t, cover));
    if (!tracks.length) return { ...out, noTracklist: true };
    return { ...out, tracks };
  } catch (e) {
    return { ...out, noTracklist: true }; // e.g. someone else's playlist — Spotify only shares songs for your own
  }
}

// All of the signed-in user's playlists (own + followed), for the "my playlists" list
async function listPlaylists() {
  if (!isConnected()) throw new Error('Connect Spotify first — click the plug icon next to the mic');
  const out = [];
  let url = '/me/playlists?limit=50';
  for (let page = 0; page < 6 && url; page++) {
    const r = await api(url);
    for (const p of (r.items || []).filter(Boolean)) {
      const total = (p.items && p.items.total) ?? (p.tracks && p.tracks.total);
      out.push({ id: p.id, name: p.name, cover: bestImage(p.images), owner: p.owner && p.owner.display_name, total: typeof total === 'number' ? total : null });
    }
    url = r.next ? r.next.replace('https://api.spotify.com/v1', '') : null;
  }
  return out;
}

async function openPlaylist(id) {
  return { ...(await playlistDetails(id)), startIndex: 0 };
}

async function findOwnPlaylist(query) {
  if (!isConnected()) return null;
  const q = query.toLowerCase().replace(/playlist/g, '').trim();
  let url = '/me/playlists?limit=50';
  for (let page = 0; page < 4 && url; page++) {
    const r = await api(url);
    const hit = (r.items || []).filter(Boolean).find((p) => p.name.toLowerCase() === q) || (r.items || []).filter(Boolean).find((p) => p.name.toLowerCase().includes(q));
    if (hit) return hit;
    url = r.next ? r.next.replace('https://api.spotify.com/v1', '') : null;
  }
  return null;
}

// Resolve a spoken/typed request into something playable with Spotify's own cover art and track list.
async function resolve({ kind, query, artist }) {
  if (kind === 'playlist') {
    const own = await findOwnPlaylist(query).catch(() => null);
    if (own) return { ...(await playlistDetails(own.id)), startIndex: 0 };
    const r = await api(`/search?type=playlist&limit=5&q=${encodeURIComponent(query)}`);
    const hit = (r.playlists.items || []).find(Boolean);
    if (!hit) throw new Error(`Couldn't find a playlist called "${query}"`);
    const details = await playlistDetails(hit.id);
    return { ...details, startIndex: 0 };
  }

  if (kind === 'album') {
    const q = artist ? `album:${query} artist:${artist}` : query;
    const r = await api(`/search?type=album&limit=1&q=${encodeURIComponent(q)}`);
    const hit = r.albums.items[0];
    if (!hit) throw new Error(`Couldn't find the album "${query}"`);
    return { ...(await albumDetails(hit.id)), startIndex: 0 };
  }

  // Track: play it inside its album so the track list and next/previous make sense
  let r = await api(`/search?type=track&limit=1&q=${encodeURIComponent(artist ? `track:${query} artist:${artist}` : query)}`);
  if (!r.tracks.items.length && artist) r = await api(`/search?type=track&limit=1&q=${encodeURIComponent(`${query} ${artist}`)}`);
  const track = r.tracks.items[0];
  if (!track) throw new Error(`Couldn't find "${query}"${artist ? ` by ${artist}` : ''} on Spotify`);
  const album = await albumDetails(track.album.id);
  const idx = album.tracks.findIndex((t) => t.uri === track.uri);
  if (idx < 0) {
    // Track missing from album listing (e.g. relinked) — show it alone
    return { kind: 'track', contextUri: null, title: track.name, subtitle: artistNames(track.artists), cover: album.cover, tracks: [mapTrack(track, album.cover)], startIndex: 0 };
  }
  return { ...album, kind: 'track', focusTitle: track.name, startIndex: idx };
}

async function trackById(id) {
  const t = await api(`/tracks/${id}`);
  const album = await albumDetails(t.album.id);
  const idx = album.tracks.findIndex((x) => x.uri === t.uri);
  return { ...album, startIndex: Math.max(0, idx) };
}

// ───────── Desktop app control (AppleScript) ─────────
function osa(script) {
  return new Promise((resolve, reject) => {
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 8000 }, (err, stdout) => {
      if (err) reject(new Error(err.message.split('\n')[0]));
      else resolve(String(stdout).trim());
    });
  });
}

async function isRunning() {
  return (await osa('application "Spotify" is running').catch(() => 'false')) === 'true';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Spotify only acts as Fuli's hidden audio engine — keep its own window out of sight if Fuli started it.
const hideSpotifyWindow = () => osa('tell application "System Events" to set visible of process "Spotify" to false').catch(() => {});

let launchedByFuli = false;

async function ensureRunning() {
  if (await isRunning()) return;
  launchedByFuli = true;
  await new Promise((r) => exec('open -g -j -a Spotify', () => r()));
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (await isRunning()) return;
  }
  throw new Error('Spotify did not start');
}

// Optional in-app playback engine (set by the main process). Falls back to the Spotify desktop app.
let engine = null;
function setEngine(e) { engine = e; }

async function playUri(trackUri, contextUri) {
  if (engine && canStream()) {
    try { return await engine.play(trackUri, contextUri); }
    catch (e) { console.warn('[spotify] in-app playback failed, using the Spotify app:', e.message); }
  }
  await ensureRunning();
  const script = !trackUri
    ? `tell application "Spotify" to play track "${contextUri}"`
    : `tell application "Spotify" to play track "${trackUri}"${contextUri ? ` in context "${contextUri}"` : ''}`;
  // Right after launch Spotify's player isn't ready yet, so retry for a few seconds
  let lastErr;
  for (let i = 0; i < 12; i++) {
    try {
      await osa(script);
      if (launchedByFuli) { await hideSpotifyWindow(); setTimeout(hideSpotifyWindow, 1500); }
      return;
    } catch (e) {
      lastErr = e;
      if (launchedByFuli) await hideSpotifyWindow();
      await sleep(1000);
    }
  }
  throw new Error(`Spotify wouldn't start playing (${lastErr ? lastErr.message.split('\n').pop().slice(0, 120) : 'unknown error'})`);
}

async function control(cmd, arg) {
  if (cmd === 'play-track') return playUri(arg.uri, arg.contextUri);
  if (engine && engine.available() && engine.control(cmd, arg)) return null;
  if (!(await isRunning())) return null;
  const map = {
    toggle: 'playpause',
    next: 'next track',
    previous: 'previous track',
    play: 'play',
    pause: 'pause'
  };
  if (cmd === 'seek') return osa(`tell application "Spotify" to set player position to ${Number(arg) || 0}`);
  if (map[cmd]) return osa(`tell application "Spotify" to ${map[cmd]}`);
  throw new Error(`Unknown Spotify command: ${cmd}`);
}

async function state() {
  if (engine && engine.available()) return engine.state();
  if (!(await isRunning())) return { running: false };
  const sep = '|~|';
  const out = await osa(`tell application "Spotify"
    set s to (player state as string)
    if s is "stopped" then return s
    set t to current track
    return s & "${sep}" & (id of t) & "${sep}" & (name of t) & "${sep}" & (artist of t) & "${sep}" & (artwork url of t) & "${sep}" & (player position as string) & "${sep}" & (duration of t)
  end tell`);
  const [playerState, id, name, artist, artwork, pos, dur] = out.split(sep);
  if (playerState === 'stopped') return { running: true, state: 'stopped' };
  return {
    running: true,
    state: playerState,
    uri: id,
    name,
    artist,
    artwork,
    positionSec: parseFloat(String(pos).replace(',', '.')) || 0,
    durationSec: (parseInt(dur, 10) || 0) / 1000
  };
}

module.exports = { listPlaylists, openPlaylist, setEngine, canStream, getUserToken, status, isConnected, connect, disconnect, isInstalled, resolve, trackById, playUri, control, state };
