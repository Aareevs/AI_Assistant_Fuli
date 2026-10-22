const { exec, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

function sh(cmd) {
  return new Promise((resolve, reject) =>
    exec(cmd, { timeout: 10000 }, (err, stdout) => (err ? reject(new Error(err.message.split('\n')[0])) : resolve(String(stdout).trim()))));
}
const osa = (script) => sh(`osascript -e '${script.replace(/'/g, "'\\''")}'`);

// ───────── Small JSON store in ~/.fuli (clipboard history, snippets) ─────────
const STORE_DIR = path.join(os.homedir(), '.fuli');

function load(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(STORE_DIR, `${name}.json`), 'utf8')); } catch (e) { return fallback; }
}

function save(name, value) {
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(path.join(STORE_DIR, `${name}.json`), JSON.stringify(value, null, 2));
  } catch (e) {}
}

// ───────── Calculator ─────────
const MATH_FUNCS = {
  sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, abs: Math.abs, ln: Math.log, log: Math.log10,
  round: Math.round, floor: Math.floor, ceil: Math.ceil
};

function evalMath(src) {
  const normalized = src.toLowerCase()
    .replace(/×|\bx\b|\btimes\b|\bmultiplied by\b/g, '*')
    .replace(/÷|\bdivided by\b|\bover\b/g, '/')
    .replace(/\bplus\b/g, '+').replace(/\bminus\b/g, '-')
    .replace(/\bto the power of\b|\bpower\b/g, '^')
    .replace(/\bsquare root of\b/g, 'sqrt')
    .replace(/,/g, '')
    .replace(/\bpi\b|π/g, String(Math.PI));
  const tokens = normalized.match(/\d+\.?\d*|\.\d+|[a-z]+|[-+*/^%()]/g);
  if (!tokens) throw new Error('empty');
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const expr = () => { let v = term(); while (peek() === '+' || peek() === '-') v = next() === '+' ? v + term() : v - term(); return v; };
  const term = () => {
    let v = power();
    while (['*', '/', '%'].includes(peek())) { const op = next(); const r = power(); v = op === '*' ? v * r : op === '/' ? v / r : v % r; }
    return v;
  };
  const power = () => { const b = unary(); if (peek() === '^') { next(); return Math.pow(b, power()); } return b; };
  const unary = () => (peek() === '-' ? (next(), -unary()) : peek() === '+' ? (next(), unary()) : atom());
  const atom = () => {
    const t = next();
    if (t === '(') { const v = expr(); if (next() !== ')') throw new Error('paren'); return v; }
    if (t !== undefined && /^[\d.]/.test(t)) return parseFloat(t);
    if (MATH_FUNCS[t]) {
      if (peek() === '(') { next(); const v = expr(); if (next() !== ')') throw new Error('paren'); return MATH_FUNCS[t](v); }
      return MATH_FUNCS[t](atom());
    }
    throw new Error('bad token');
  };
  const v = expr();
  if (i < tokens.length || !isFinite(v)) throw new Error('invalid');
  return +v.toPrecision(12);
}

// "15% of 80", "10 km to miles", "72 f to c", or plain arithmetic
const UNITS = {
  m: 1, meter: 1, meters: 1, km: 1000, kilometers: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, mile: 1609.344, miles: 1609.344,
  ft: 0.3048, feet: 0.3048, foot: 0.3048, in: 0.0254, inch: 0.0254, inches: 0.0254
};
const MASS = { kg: 1, kilograms: 1, g: 0.001, grams: 0.001, lb: 0.45359237, lbs: 0.45359237, pounds: 0.45359237, oz: 0.0283495, ounces: 0.0283495 };
const TEMP = { c: 'c', celsius: 'c', f: 'f', fahrenheit: 'f', k: 'k', kelvin: 'k' };

function calculate(expression) {
  const q = expression.trim().toLowerCase();
  const pct = q.match(/^([\d.]+)\s*(?:%|percent)\s*of\s*([\d.]+)$/);
  if (pct) return { result: String(+((parseFloat(pct[1]) / 100) * parseFloat(pct[2])).toFixed(6)), expression };

  const conv = q.match(/^(-?[\d.]+)\s*(?:degrees\s+)?([a-z]+)\s+(?:to|in|into)\s+(?:degrees\s+)?([a-z]+)$/);
  if (conv) {
    const [, n, from, to] = conv;
    const v = parseFloat(n);
    if (TEMP[from] && TEMP[to]) {
      const c = TEMP[from] === 'c' ? v : TEMP[from] === 'f' ? (v - 32) * 5 / 9 : v - 273.15;
      const out = TEMP[to] === 'c' ? c : TEMP[to] === 'f' ? c * 9 / 5 + 32 : c + 273.15;
      return { result: `${+out.toFixed(2)} °${TEMP[to].toUpperCase()}`, expression };
    }
    for (const table of [UNITS, MASS]) {
      if (table[from] && table[to]) return { result: `${+((v * table[from]) / table[to]).toPrecision(8)} ${to}`, expression };
    }
  }
  return { result: String(evalMath(q)), expression };
}

// ───────── Window snapping ─────────
let targetApp = null;

// Called right before Fuli's window appears so we know which app's window to move.
async function captureFrontmost() {
  if (!isMac) return;
  try {
    const name = await osa('tell application "System Events" to get name of first process whose frontmost is true');
    if (name && !/^(Electron|Fuli)$/i.test(name)) targetApp = name;
  } catch (e) {}
}

const LAYOUTS = {
  'left-half': [0, 0, 0.5, 1], 'right-half': [0.5, 0, 0.5, 1], 'top-half': [0, 0, 1, 0.5], 'bottom-half': [0, 0.5, 1, 0.5],
  'top-left': [0, 0, 0.5, 0.5], 'top-right': [0.5, 0, 0.5, 0.5], 'bottom-left': [0, 0.5, 0.5, 0.5], 'bottom-right': [0.5, 0.5, 0.5, 0.5],
  'left-third': [0, 0, 1 / 3, 1], 'center-third': [1 / 3, 0, 1 / 3, 1], 'right-third': [2 / 3, 0, 1 / 3, 1],
  'left-two-thirds': [0, 0, 2 / 3, 1], 'right-two-thirds': [1 / 3, 0, 2 / 3, 1],
  maximize: [0, 0, 1, 1], center: [0.15, 0.1, 0.7, 0.8]
};

async function snapWindow(layout, workArea) {
  const f = LAYOUTS[layout];
  if (!f) throw new Error(`Unknown window layout: ${layout}`);
  const x = Math.round(workArea.x + f[0] * workArea.width);
  const y = Math.round(workArea.y + f[1] * workArea.height);
  const w = Math.round(f[2] * workArea.width);
  const h = Math.round(f[3] * workArea.height);
  if (isMac) {
    if (!targetApp) throw new Error('No window to move — open Fuli while the app you want to move is in front');
    await osa(`tell application "System Events" to tell process "${targetApp.replace(/["\\]/g, '')}"
      set position of window 1 to {${x}, ${y}}
      set size of window 1 to {${w}, ${h}}
    end tell`);
    return targetApp;
  }
  throw new Error('Window snapping is only supported on macOS right now');
}

// ───────── System commands ─────────
let caffeinateProc = null;

const SYSTEM_COMMANDS = {
  lock: async () => { if (isWin) await sh('rundll32.exe user32.dll,LockWorkStation'); else await sh('pmset displaysleepnow'); return 'Screen locked.'; },
  sleep: async () => { if (isWin) await sh('rundll32.exe powrprof.dll,SetSuspendState 0,1,0'); else await sh('pmset sleepnow'); return 'Going to sleep.'; },
  'dark-mode-on': async () => { await osa('tell application "System Events" to tell appearance preferences to set dark mode to true'); return 'Dark mode on.'; },
  'dark-mode-off': async () => { await osa('tell application "System Events" to tell appearance preferences to set dark mode to false'); return 'Light mode on.'; },
  'dark-mode-toggle': async () => { await osa('tell application "System Events" to tell appearance preferences to set dark mode to not dark mode'); return 'Appearance toggled.'; },
  'empty-trash': async () => { await osa('tell application "Finder" to empty trash'); return 'Trash emptied.'; },
  'caffeinate-on': async () => {
    if (!caffeinateProc) {
      caffeinateProc = spawn('caffeinate', ['-d', '-i'], { stdio: 'ignore' });
      caffeinateProc.on('exit', () => { caffeinateProc = null; });
    }
    return 'Keeping your Mac awake.';
  },
  'caffeinate-off': async () => { if (caffeinateProc) caffeinateProc.kill(); return 'Your Mac can sleep again.'; },
  unmute: async () => { await osa('set volume output muted false'); return 'Unmuted.'; },
  'volume-up': async () => {
    const v = parseInt(await osa('output volume of (get volume settings)'), 10) || 0;
    await osa(`set volume output volume ${Math.min(100, v + 10)}`);
    return `Volume ${Math.min(100, v + 10)} percent.`;
  },
  'volume-down': async () => {
    const v = parseInt(await osa('output volume of (get volume settings)'), 10) || 0;
    await osa(`set volume output volume ${Math.max(0, v - 10)}`);
    return `Volume ${Math.max(0, v - 10)} percent.`;
  }
};

async function runSystemCommand(id) {
  const fn = SYSTEM_COMMANDS[id];
  if (!fn) throw new Error(`Unknown system command: ${id}`);
  if (!isMac && !['lock', 'sleep'].includes(id)) throw new Error('This command is only supported on macOS right now');
  return fn();
}

// ───────── Clipboard history ─────────
const MAX_CLIPS = 200;
let lastClip = null;

// Called on an interval by the main process with the current clipboard text.
function recordClipboard(text) {
  if (!text || !text.trim() || text === lastClip) return;
  lastClip = text;
  const list = load('clipboard', []).filter((c) => c.text !== text);
  list.unshift({ text, ts: Date.now() });
  save('clipboard', list.slice(0, MAX_CLIPS));
}

function clipboardHistory(query, limit = 30) {
  const q = (query || '').toLowerCase();
  return load('clipboard', []).filter((c) => !q || c.text.toLowerCase().includes(q)).slice(0, limit);
}

function clearClipboardHistory() { save('clipboard', []); }

// ───────── Snippets ─────────
function snippets() { return load('snippets', []); }

function saveSnippet(name, text) {
  const list = snippets().filter((s) => s.name.toLowerCase() !== name.toLowerCase());
  list.unshift({ name, text, ts: Date.now() });
  save('snippets', list);
}

function findSnippet(name) {
  const n = name.toLowerCase();
  const list = snippets();
  return list.find((s) => s.name.toLowerCase() === n) || list.find((s) => s.name.toLowerCase().includes(n));
}

function deleteSnippet(name) {
  const before = snippets();
  const after = before.filter((s) => s.name.toLowerCase() !== name.toLowerCase());
  save('snippets', after);
  return before.length !== after.length;
}

// Put text in the clipboard and send ⌘V to the app that was in front before Fuli.
async function pasteIntoFrontmost(text, writeClipboard) {
  writeClipboard(text);
  lastClip = text;
  if (!isMac) return;
  const activate = targetApp ? `tell application "${targetApp.replace(/["\\]/g, '')}" to activate\ndelay 0.15\n` : '';
  await osa(`${activate}tell application "System Events" to keystroke "v" using command down`);
}

module.exports = {
  calculate, captureFrontmost, snapWindow, LAYOUTS, runSystemCommand,
  recordClipboard, clipboardHistory, clearClipboardHistory,
  snippets, saveSnippet, findSnippet, deleteSnippet, pasteIntoFrontmost
};
