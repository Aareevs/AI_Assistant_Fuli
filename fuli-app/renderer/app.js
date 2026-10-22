const promptInput = document.getElementById('promptInput');
const submitBtn = document.getElementById('submitBtn');
const cancelBtn = document.getElementById('cancelBtn');
const closeBtn = document.getElementById('closeBtn');
const micBtn = document.getElementById('micBtn');
const actionCard = document.getElementById('actionCard');
const statusText = document.getElementById('statusText');
const summaryText = document.getElementById('summaryText');
const statusSpinner = document.getElementById('statusSpinner');
const stepsList = document.getElementById('stepsList');
const resultCard = document.getElementById('resultCard');
const connectorsBtn = document.getElementById('connectorsBtn');
const connectorsPanel = document.getElementById('connectorsPanel');

let isRunning = false;
let currentSteps = [];

// Focus input on load
promptInput.focus();

function resetToCleanState() {
  if (!isRunning) {
    promptInput.value = '';
    statusText.textContent = 'Fuli is ready';
    summaryText.textContent = '';
    stepsList.innerHTML = '';
    // Keep the player around between opens so it works like a mini now-playing widget
    if (activePlayer) showCard(activePlayer);
    else {
      clearCard();
      setExpanded(false);
    }
  }
}

if (window.fuliAPI && window.fuliAPI.onFocusInput) {
  window.fuliAPI.onFocusInput(() => {
    resetToCleanState();
    promptInput.focus();
  });
}

window.addEventListener('focus', () => {
  resetToCleanState();
  promptInput.focus();
});

if (window.fuliAPI && window.fuliAPI.onSetPromptAndRun) {
  window.fuliAPI.onSetPromptAndRun((prompt) => {
    promptInput.value = prompt;
    if (micBtn) micBtn.classList.remove('listening');
    startExecution();
  });
}

if (window.fuliAPI && window.fuliAPI.onSetPromptOnly) {
  window.fuliAPI.onSetPromptOnly((prompt) => {
    promptInput.value = prompt;
    if (micBtn) micBtn.classList.remove('listening');
    promptInput.focus();
  });
}

if (window.fuliAPI && window.fuliAPI.onSetStatus) {
  window.fuliAPI.onSetStatus((status) => {
    statusText.textContent = status;
    setExpanded(true, 130);
  });
}

let baseHeight = 76;

function applyHeight() {
  const extra = connectorsPanel && !connectorsPanel.classList.contains('hidden') ? connectorsPanel.offsetHeight : 0;
  window.fuliAPI.resizeWindow(680, baseHeight + extra);
}

function setExpanded(expanded, customHeight) {
  if (expanded) {
    actionCard.classList.remove('hidden');
    baseHeight = customHeight || 360;
  } else {
    actionCard.classList.add('hidden');
    baseHeight = 76;
  }
  applyHeight();
}

function renderSteps(steps) {
  currentSteps = steps;
  stepsList.innerHTML = '';

  steps.forEach((step) => {
    const el = document.createElement('div');
    el.className = 'step-item';
    el.id = `step-${step.id}`;

    const icon = document.createElement('span');
    icon.className = 'step-icon';
    icon.textContent = '○';

    const text = document.createElement('span');
    text.className = 'step-text';
    text.textContent = step.description;

    const badge = document.createElement('span');
    badge.className = 'step-badge';
    badge.textContent = step.action.replace('browser_', '').replace('system_', '');

    el.appendChild(icon);
    el.appendChild(text);
    el.appendChild(badge);
    stepsList.appendChild(el);
  });

  // Calculate dynamic height based on steps
  const cardHeight = Math.min(140 + steps.length * 48, 420);
  setExpanded(true, cardHeight);
}

function updateStepStatus(stepId, state) {
  const el = document.getElementById(`step-${stepId}`);
  if (!el) return;

  const icon = el.querySelector('.step-icon');

  if (state === 'active') {
    el.className = 'step-item active';
    if (icon) icon.textContent = '▶';
  } else if (state === 'completed') {
    el.className = 'step-item completed';
    if (icon) icon.textContent = '✓';
  }
}

function startExecution() {
  const prompt = promptInput.value.trim();
  if (!prompt || isRunning) return;

  isRunning = true;
  submitBtn.classList.add('hidden');
  cancelBtn.classList.remove('hidden');
  promptInput.disabled = true;

  clearCard();
  statusText.textContent = 'Fuli is planning your actions...';
  summaryText.textContent = '';
  statusSpinner.classList.remove('hidden');
  stepsList.innerHTML = '';
  setExpanded(true, 150);

  window.fuliAPI.submitPrompt(prompt);
}

function stopExecution() {
  window.fuliAPI.cancelTask();
  statusText.textContent = 'Task stopped.';
  statusSpinner.classList.add('hidden');
  resetUIState();
}

function resetUIState() {
  isRunning = false;
  submitBtn.classList.remove('hidden');
  cancelBtn.classList.add('hidden');
  promptInput.disabled = false;
  if (micBtn) micBtn.classList.remove('listening');
  promptInput.focus();
}

// Event Listeners
submitBtn.addEventListener('click', startExecution);
cancelBtn.addEventListener('click', stopExecution);
if (closeBtn) {
  closeBtn.addEventListener('click', () => {
    clearCard();
    resetToCleanState();
    window.fuliAPI.closeApp();
  });
}
if (micBtn) {
  micBtn.addEventListener('click', () => {
    micBtn.classList.toggle('listening');
    if (micBtn.classList.contains('listening')) {
      statusText.textContent = "🎙️ Listening... Speak your command to Fuli";
      setExpanded(true, 130);
      if (window.fuliAPI && window.fuliAPI.triggerMicListen) {
        window.fuliAPI.triggerMicListen();
      }
    } else {
      setExpanded(false);
    }
  });
}

promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    startExecution();
  } else if (e.key === 'Escape') {
    if (isRunning) {
      stopExecution();
    } else {
      resetToCleanState();
      window.fuliAPI.hideWindow();
    }
  }
});

// IPC Progress Stream from Electron Main Process
window.fuliAPI.onProgress((data) => {
  if (data.type === 'status') {
    statusText.textContent = data.message;
  } else if (data.type === 'plan_ready') {
    statusText.textContent = 'Executing actions on screen...';
    summaryText.textContent = data.summary;
    renderSteps(data.steps);
  } else if (data.type === 'step_start') {
    updateStepStatus(data.stepId, 'active');
  } else if (data.type === 'step_done') {
    updateStepStatus(data.stepId, 'completed');
  } else if (data.type === 'card') {
    showCard(data.card);
  } else if (data.type === 'cancelled') {
    statusText.textContent = data.message;
    statusSpinner.classList.add('hidden');
    resetUIState();
  }
});

window.fuliAPI.onComplete((result) => {
  statusSpinner.classList.add('hidden');
  statusText.textContent = 'Done';
  statusText.style.color = '#5fd68a';
  resetUIState();

  // Reset color after 4 seconds
  setTimeout(() => {
    statusText.style.color = '';
  }, 4000);
});

window.fuliAPI.onError((err) => {
  statusSpinner.classList.add('hidden');
  statusText.textContent = `Error: ${err.message}`;
  statusText.style.color = '#ff8585';
  resetUIState();

  setTimeout(() => {
    statusText.style.color = '';
  }, 5000);
});

// ───────── Result cards (calculator, system, lists, Fuli player) ─────────
let activePlayer = null;
let pollTimer = null;
let lastState = null;

const svg = (d, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor">${d}</svg>`;
const ICONS = {
  prev: svg('<path d="M6 5h2v14H6zM20 5v14L9 12z"/>'),
  next: svg('<path d="M16 5h2v14h-2zM4 5l11 7-11 7z"/>'),
  play: svg('<path d="M7 4.5v15l13-7.5z"/>', 18),
  pause: svg('<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>', 18)
};

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const fmtTime = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

function relTime(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function clearCard() {
  activePlayer = null;
  stopPolling();
  resultCard.innerHTML = '';
  resultCard.classList.add('hidden');
  actionCard.classList.remove('card-only');
  stepsList.classList.remove('hidden');
}

function showCard(card) {
  resultCard.innerHTML = '';
  resultCard.classList.remove('hidden');
  stepsList.classList.add('hidden');
  actionCard.classList.add('card-only');
  stopPolling();
  activePlayer = null;

  if (card.kind === 'result') {
    resultCard.appendChild(el('div', 'rc-result-title', card.title));
    if (card.subtitle) resultCard.appendChild(el('div', 'rc-result-sub', card.subtitle));
    setExpanded(true, 160);
  } else if (card.kind === 'list') {
    renderListCard(card);
  } else if (card.kind === 'player') {
    activePlayer = card;
    renderPlayer(card);
    startPolling();
  }
}

function renderListCard(card) {
  const head = el('div', 'rc-list-head');
  head.appendChild(el('span', 'rc-list-title', card.title));
  head.appendChild(el('span', 'rc-list-hint', card.hint || ''));
  resultCard.appendChild(head);
  if (!card.items.length) resultCard.appendChild(el('div', 'rc-empty', card.empty));
  const list = el('div', 'player-tracks');
  list.style.borderTop = 'none';
  list.style.marginTop = '0';
  list.style.maxHeight = '260px';
  card.items.forEach((item) => {
    const row = el('div', 'rc-row');
    if (item.label) row.appendChild(el('span', 'rc-row-label', item.label));
    row.appendChild(el('span', 'rc-row-text', item.text.replace(/\s+/g, ' ')));
    const meta = el('span', 'rc-row-meta', item.ts ? relTime(item.ts) : '');
    row.appendChild(meta);
    row.title = item.text;
    row.addEventListener('click', async () => {
      await window.fuliAPI.copyText(item.text);
      row.classList.add('copied');
      meta.textContent = 'Copied';
    });
    list.appendChild(row);
  });
  resultCard.appendChild(list);
  setExpanded(true, Math.min(150 + Math.max(card.items.length, 1) * 36, 420));
}

function renderPlayer(card) {
  const top = el('div', 'player-top');
  const cover = el('img', 'player-cover');
  cover.id = 'playerCover';
  if (card.cover) cover.src = card.cover;
  top.appendChild(cover);

  const meta = el('div', 'player-meta');
  meta.appendChild(el('div', 'player-kind', card.mediaKind === 'playlist' ? 'Playlist' : card.mediaKind === 'album' ? 'Album' : 'Song'));
  meta.appendChild(el('div', 'player-title', card.mediaKind === 'track' && card.focusTitle ? card.focusTitle : card.title));
  meta.appendChild(el('div', 'player-sub', card.mediaKind === 'track' ? `${card.tracks[card.startIndex].artist} · ${card.title}` : card.subtitle));
  const now = el('div', 'player-now');
  now.id = 'playerNow';
  meta.appendChild(now);

  const controls = el('div', 'player-controls');
  const btn = (cls, html, cmd, title) => {
    const b = el('button', `pc-btn ${cls}`);
    b.innerHTML = html;
    b.title = title;
    b.addEventListener('click', async () => {
      const stopped = !lastState || !lastState.running || lastState.state === 'stopped';
      if (cmd === 'toggle' && stopped && activePlayer) {
        // Nothing is playing yet (e.g. a playlist that was only opened) — start it
        const first = activePlayer.tracks[0];
        await window.fuliAPI.spotify('play-track', { uri: first ? first.uri : null, contextUri: activePlayer.contextUri });
      } else {
        await window.fuliAPI.spotify(cmd);
      }
      setTimeout(pollState, 400);
    });
    return b;
  };
  controls.appendChild(btn('', ICONS.prev, 'previous', 'Previous'));
  const playBtn = btn('main', ICONS.pause, 'toggle', 'Play / Pause');
  playBtn.id = 'playerToggle';
  controls.appendChild(playBtn);
  controls.appendChild(btn('', ICONS.next, 'next', 'Next'));
  const tPos = el('span', 'pc-time', '0:00');
  tPos.id = 'playerPos';
  const bar = el('div', 'pc-bar');
  const fill = el('div', 'pc-fill');
  fill.id = 'playerFill';
  bar.appendChild(fill);
  bar.addEventListener('click', async (e) => {
    if (!lastState || !lastState.durationSec) return;
    const r = bar.getBoundingClientRect();
    await window.fuliAPI.spotify('seek', ((e.clientX - r.left) / r.width) * lastState.durationSec);
    pollState();
  });
  const tDur = el('span', 'pc-time', '0:00');
  tDur.id = 'playerDur';
  controls.appendChild(tPos);
  controls.appendChild(bar);
  controls.appendChild(tDur);
  meta.appendChild(controls);
  top.appendChild(meta);
  resultCard.appendChild(top);

  const list = el('div', 'player-tracks');
  card.tracks.forEach((t, i) => {
    const row = el('div', 'pt-row');
    row.dataset.uri = t.uri;
    row.appendChild(el('span', 'pt-num', String(i + 1)));
    if (card.mediaKind === 'playlist' && t.cover) {
      const img = el('img', 'pt-img');
      img.src = t.cover;
      img.loading = 'lazy';
      row.appendChild(img);
    }
    const text = el('div', 'pt-text');
    text.appendChild(el('div', 'pt-name', t.name));
    text.appendChild(el('div', 'pt-artist', t.artist));
    row.appendChild(text);
    row.appendChild(el('span', 'pt-dur', fmtTime((t.durationMs || 0) / 1000)));
    row.addEventListener('click', async () => {
      const res = await window.fuliAPI.spotify('play-track', { uri: t.uri, contextUri: card.contextUri });
      if (res && !res.ok) statusText.textContent = res.error;
      setTimeout(pollState, 300);
    });
    list.appendChild(row);
  });
  if (card.noTracklist) {
    list.appendChild(el('div', 'rc-empty', 'Playing in the background. Say “connect spotify” to see this playlist’s songs here.'));
  }
  resultCard.appendChild(list);
  if (!card.idle) markCurrent(card.tracks[card.startIndex] && card.tracks[card.startIndex].uri, true);
  setExpanded(true, (card.fromList ? 28 : 0) + (card.noTracklist ? 290 : Math.min(76 + 32 + 120 + 20 + card.tracks.length * 42, 470)));
}

function markCurrent(uri, scroll) {
  let current = null;
  resultCard.querySelectorAll('.pt-row').forEach((r) => {
    const on = r.dataset.uri === uri;
    r.classList.toggle('current', on);
    if (on) current = r;
  });
  if (current && scroll) current.scrollIntoView({ block: 'nearest' });
}

async function pollState() {
  if (!activePlayer) return;
  const res = await window.fuliAPI.spotify('state');
  if (!res || !res.ok || !activePlayer) return;
  const st = res.data;
  const prevUri = lastState && lastState.uri;
  lastState = st;
  const now = document.getElementById('playerNow');
  const toggle = document.getElementById('playerToggle');
  if (!now || !toggle) return;
  if (!st.running || st.state === 'stopped') {
    now.textContent = 'Not playing — press play or pick a song';
    toggle.innerHTML = ICONS.play;
    return;
  }
  now.innerHTML = '';
  now.appendChild(document.createTextNode(st.name + ' '));
  now.appendChild(el('span', '', `— ${st.artist}`));
  toggle.innerHTML = st.state === 'playing' ? ICONS.pause : ICONS.play;
  document.getElementById('playerPos').textContent = fmtTime(st.positionSec);
  document.getElementById('playerDur').textContent = fmtTime(st.durationSec);
  document.getElementById('playerFill').style.width = `${st.durationSec ? Math.min(100, (st.positionSec / st.durationSec) * 100) : 0}%`;
  if (activePlayer.mediaKind !== 'playlist' && st.artwork) document.getElementById('playerCover').src = st.artwork;
  markCurrent(st.uri, st.uri !== prevUri);
}

function startPolling() {
  stopPolling();
  pollState();
  pollTimer = setInterval(() => { if (!document.hidden) pollState(); }, 1000);
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

// ───────── Connectors (Spotify, more later) ─────────
const SPOTIFY_ICON = '<svg width="22" height="22" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#1ed760"/><path d="M5.8 9.2c4.2-1.2 8.7-.9 12.4 1.3" stroke="#0b0b0c" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M6.6 12.5c3.5-1 7.1-.7 10.1 1" stroke="#0b0b0c" stroke-width="1.7" fill="none" stroke-linecap="round"/><path d="M7.4 15.6c2.8-.7 5.4-.5 7.8.8" stroke="#0b0b0c" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>';

function closeConnectors() {
  if (connectorsPanel.classList.contains('hidden')) return;
  connectorsPanel.classList.add('hidden');
  connectorsBtn.classList.remove('active');
  applyHeight();
  promptInput.focus();
}

async function renderConnectors(busy, error) {
  const res = await window.fuliAPI.spotify('status');
  const st = res && res.ok ? res.data : { installed: false, connected: false };
  connectorsPanel.innerHTML = '';
  connectorsPanel.appendChild(el('div', 'cp-title', 'Connectors'));

  const row = el('div', 'cp-row');
  const icon = el('div', 'cp-icon');
  icon.innerHTML = SPOTIFY_ICON;
  row.appendChild(icon);

  const text = el('div', 'cp-text');
  text.appendChild(el('div', 'cp-name', 'Spotify'));
  const sub = !st.installed ? 'Install the Spotify app to use this'
    : busy ? 'Approve Fuli in your browser…'
    : st.needsReconnect ? 'Reconnect once to play music inside Fuli'
    : st.connected ? `Connected${st.name ? ` as ${st.name}` : ''}`
    : 'Play your playlists and see their songs';
  text.appendChild(el('div', 'cp-sub' + (st.connected && !st.needsReconnect && !busy ? ' ok' : ''), sub));
  row.appendChild(text);

  if (st.installed) {
    const btn = el('button', 'cp-btn' + (st.connected && !st.needsReconnect ? ' secondary' : ''), busy ? 'Waiting…' : st.needsReconnect ? 'Reconnect' : st.connected ? 'Disconnect' : 'Connect');
    btn.disabled = !!busy;
    btn.addEventListener('click', async () => {
      if (st.connected && !st.needsReconnect) {
        await window.fuliAPI.spotify('disconnect');
        renderConnectors();
      } else {
        renderConnectors(true);
        const r = await window.fuliAPI.spotify('connect');
        renderConnectors(false, r && !r.ok ? r.error : null);
      }
    });
    row.appendChild(btn);
  }
  connectorsPanel.appendChild(row);
  if (error) connectorsPanel.appendChild(el('div', 'cp-error', error));
  connectorsPanel.appendChild(el('div', 'cp-foot', 'Then just say “play …” or “open my … playlist”.'));
  applyHeight();
}

connectorsBtn.addEventListener('click', async () => {
  if (!connectorsPanel.classList.contains('hidden')) return closeConnectors();
  connectorsPanel.classList.remove('hidden');
  connectorsBtn.classList.add('active');
  await renderConnectors();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !connectorsPanel.classList.contains('hidden')) {
    e.stopPropagation();
    closeConnectors();
  }
}, true);

document.addEventListener('mousedown', (e) => {
  if (!connectorsPanel.classList.contains('hidden') && !connectorsPanel.contains(e.target) && !connectorsBtn.contains(e.target)) closeConnectors();
});
