const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const spotify = require('./spotify');

// In-app Spotify playback: a hidden window runs Spotify's Web Playback SDK so Fuli itself is the
// playback device. If anything about it fails (no Widevine, not Premium...) available() is false and
// spotify.js falls back to driving the Spotify desktop app.
let win = null;
let deviceId = null;
let lastError = null;
let snapshot = null; // last player_state_changed payload + receive time
let readyWaiters = [];
let lastPlaybackError = 0;
let drmBroken = false; // Spotify refuses to stream to this build (unsigned Widevine) — stay on the desktop app

const fs = require('fs');
const os = require('os');
const LOG = path.join(os.homedir(), '.fuli', 'player.log');
function log(msg) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (e) {}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ipcMain.handle('player:token', () => spotify.getUserToken());

ipcMain.on('player:event', (_e, event, data) => {
  if (event === 'ready') {
    deviceId = data.deviceId;
    lastError = null;
    log(`ready device=${data.deviceId}`);
    readyWaiters.splice(0).forEach((fn) => fn(true));
  } else if (event === 'not_ready') {
    deviceId = null;
  } else if (event === 'state') {
    snapshot = data ? { state: data, at: Date.now() } : null;
    if (data && data.track_window && data.track_window.current_track) {
      log(`state paused=${data.paused} pos=${data.position} track="${data.track_window.current_track.name}" ctx=${data.context && data.context.uri} reason=${JSON.stringify(data.disallows || {})}`);
    }
  } else if (event === 'error') {
    lastError = data;
    if (data.kind === 'playback_error') lastPlaybackError = Date.now();
    console.warn(`[player] ${data.kind}: ${data.message}`);
    log(`ERROR ${data.kind}: ${data.message}`);
    if (data.kind === 'drm' || data.kind === 'initialization_error' || data.kind === 'authentication_error' || data.kind === 'account_error') {
      deviceId = null;
      readyWaiters.splice(0).forEach((fn) => fn(false));
    }
  }
});

function start() {
  if (win && !win.isDestroyed()) return;
  if (!spotify.canStream()) return;
  deviceId = null;
  lastError = null;
  win = new BrowserWindow({
    show: false,
    width: 300,
    height: 200,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'player', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false
    }
  });
  win.on('closed', () => { win = null; deviceId = null; });
  win.loadFile(path.join(__dirname, '..', 'player', 'player.html'));
}

function stop() {
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
  deviceId = null;
  snapshot = null;
}

function available() {
  return !drmBroken && !!(win && !win.isDestroyed() && deviceId);
}

// Resolves true once the SDK reports a device id, false on a hard failure or timeout.
function whenReady(timeoutMs = 15000) {
  if (available()) return Promise.resolve(true);
  start();
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), timeoutMs);
    readyWaiters.push((ok) => { clearTimeout(t); resolve(ok); });
  });
}

async function web(method, endpoint, body) {
  const token = await spotify.getUserToken();
  if (!token) throw new Error('Spotify is not connected');
  const res = await fetch(`https://api.spotify.com/v1${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok && res.status !== 204) {
    let msg = `Spotify error ${res.status}`;
    try { msg = (await res.json()).error.message || msg; } catch (e) {}
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
}

async function play(trackUri, contextUri) {
  if (drmBroken) throw new Error('In-app playback is not supported by this build');
  if (!(await whenReady())) throw new Error(lastError ? lastError.message : 'Fuli player is not ready');
  win.webContents.send('player:cmd', 'activate');

  const body = contextUri
    ? { context_uri: contextUri, ...(trackUri ? { offset: { uri: trackUri } } : {}) }
    : { uris: [trackUri] };

  let err;
  for (let i = 0; i < 6; i++) {
    try {
      // First call moves playback to Fuli, then start the requested music on it
      await web('PUT', '/me/player', { device_ids: [deviceId], play: false }).catch(() => {});
      const startedAt = Date.now();
      await web('PUT', `/me/player/play?device_id=${deviceId}`, body);
      // If the track can't be decoded, the SDK reports playback_error within a couple of seconds
      await sleep(3500);
      if (lastPlaybackError >= startedAt) {
        drmBroken = true;
        stop(); // fully shut the broken player down so it can't keep skipping tracks
        log('playback_error right after start — falling back to the Spotify desktop app');
        throw new Error('Spotify blocked in-app audio for this build');
      }
      return;
    } catch (e) {
      err = e;
      if (drmBroken) throw e;
      if (e.status === 403) throw new Error(`Spotify refused playback: ${e.message}`); // e.g. not Premium
      await sleep(700);
    }
  }
  throw err;
}

function control(cmd, arg) {
  if (!available()) return false;
  win.webContents.send('player:cmd', cmd, arg);
  return true;
}

function state() {
  if (!snapshot || !snapshot.state || !snapshot.state.track_window || !snapshot.state.track_window.current_track) {
    return { running: true, state: 'stopped' };
  }
  const s = snapshot.state;
  const t = s.track_window.current_track;
  const pos = (s.position + (s.paused ? 0 : Date.now() - snapshot.at)) / 1000;
  return {
    running: true,
    state: s.paused ? 'paused' : 'playing',
    uri: t.uri,
    name: t.name,
    artist: (t.artists || []).map((a) => a.name).join(', '),
    artwork: t.album && t.album.images && t.album.images[0] ? t.album.images[0].url : null,
    positionSec: Math.min(pos, s.duration / 1000),
    durationSec: s.duration / 1000
  };
}

module.exports = { start, stop, available, whenReady, play, control, state, lastError: () => lastError };
