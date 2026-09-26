const { app, BrowserWindow, globalShortcut, ipcMain, screen, Tray, Menu, nativeImage, systemPreferences } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

const envCandidates = [
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../../../.env'),
  path.join(os.homedir(), 'VS-Code/AI_Assistant_Fuli/.env'),
  path.join(os.homedir(), '.fuli/.env'),
  path.join(os.homedir(), '.env')
];

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
    break;
  }
}

const { actionExecutor } = require('./automation/executor');
const http = require('http');

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

const LOG_FILE = path.join(os.tmpdir(), 'fuli_app.log');
function logFuli(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch(e) {}
  console.log(...args);
}

let mainWindow = null;
let tray = null;
let isTaskRunning = false;
let voiceProcess = null;
let allowBlurHide = false;
let focusTimestamp = 0;

function startLocalCommandServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/command') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { prompt } = JSON.parse(body);
          if (prompt) {
            showWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('fuli:set-prompt-and-run', prompt);
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    } else if (req.method === 'POST' && req.url === '/set-prompt') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { prompt, run } = JSON.parse(body);
          showWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            if (run) {
              mainWindow.webContents.send('fuli:set-prompt-and-run', prompt);
            } else {
              mainWindow.webContents.send('fuli:set-prompt-only', prompt);
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    } else if (req.method === 'POST' && req.url === '/status') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { status } = JSON.parse(body);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('fuli:set-status', status);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    } else if (req.url === '/show') {
      showWindow();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Window displayed' }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(8765, '127.0.0.1', () => {
    console.log('⚡ Fuli command server listening on http://127.0.0.1:8765');
  });

  server.on('error', (e) => {
    console.warn('Command server notice:', e.message);
  });
}

const DEFAULT_WIDTH = 680;
const DEFAULT_HEIGHT = 76; // compact prompt bar
const EXPANDED_HEIGHT = 420; // when steps/progress are active

function createTray() {
  const trayIconPath = path.resolve(__dirname, 'renderer/assets/tray-icon.png');
  let icon = nativeImage.createFromPath(trayIconPath);
  
  if (icon.isEmpty()) {
    const logoPath = path.resolve(__dirname, '../images/Fuli_Logo.png');
    icon = nativeImage.createFromPath(logoPath).resize({ width: 18, height: 18 });
  }

  tray = new Tray(icon);
  tray.setToolTip('Fuli — AI Screen & Browser Operator (Click to toggle)');

  const shortcutHint = isMac ? 'Option+Space' : 'Alt+Space';
  const contextMenu = Menu.buildFromTemplate([
    { label: `⚡ Show / Hide Fuli (${shortcutHint})`, click: toggleWindow },
    { type: 'separator' },
    { label: 'Quit Fuli', click: () => app.quit() }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', toggleWindow);
}

function createWindow() {
  const cursorPoint = screen.getCursorScreenPoint();
  const currentDisplay = screen.getDisplayNearestPoint(cursorPoint);
  const { x: displayX, y: displayY, width: displayWidth } = currentDisplay.workArea;

  const x = Math.round(displayX + (displayWidth - DEFAULT_WIDTH) / 2);
  const y = displayY + 140; // Pin near top like Spotlight / Raycast / PowerToys Run

  mainWindow = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    x: x,
    y: y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hiddenInMissionControl: isMac,
    hasShadow: true,
    show: false,
    type: isMac ? 'panel' : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Ensure true floating always-on-top across desktops/workspaces
  mainWindow.setAlwaysOnTop(true, isMac ? 'screen-saver' : 'pop-up-menu', 1);
  if (isMac && mainWindow.setVisibleOnAllWorkspaces) {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  }

  // Auto-dismiss on click outside when idle
  mainWindow.on('show', () => {
    allowBlurHide = false;
    focusTimestamp = Date.now();
  });

  mainWindow.on('focus', () => {
    focusTimestamp = Date.now();
    setTimeout(() => {
      allowBlurHide = true;
    }, 400);
  });

  mainWindow.on('blur', () => {
    const elapsed = Date.now() - focusTimestamp;
    if (allowBlurHide && elapsed > 400 && !isTaskRunning && mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      allowBlurHide = false;
      hideWindow();
    }
  });

  // Never destroy window on close; hide it so hotkey always works
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      hideWindow();
    }
  });
}

function showWindow() {
  if (!mainWindow) return;

  allowBlurHide = false;
  focusTimestamp = Date.now();

  // Dynamically locate the display where the user's cursor currently is
  const cursorPoint = screen.getCursorScreenPoint();
  const currentDisplay = screen.getDisplayNearestPoint(cursorPoint);
  const { x: displayX, y: displayY, width: displayWidth } = currentDisplay.workArea;
  const x = Math.round(displayX + (displayWidth - DEFAULT_WIDTH) / 2);
  const y = displayY + 140;
  mainWindow.setPosition(x, y);

  if (isMac && mainWindow.setVisibleOnAllWorkspaces) {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  }
  mainWindow.setAlwaysOnTop(true, isMac ? 'screen-saver' : 'pop-up-menu', 1);

  mainWindow.show();
  mainWindow.focus();
  mainWindow.moveTop();
  mainWindow.webContents.send('fuli:focus-input');
}

function hideWindow() {
  if (!mainWindow) return;
  mainWindow.hide();
}

function toggleWindow() {
  if (!mainWindow) return;

  if (mainWindow.isVisible()) {
    hideWindow();
  } else {
    showWindow();
  }
}

function startVoiceOperator() {
  const possibleScriptPaths = [
    path.join(os.homedir(), 'VS-Code', 'AI_Assistant_Fuli', 'fuli', 'voice_operator.py'),
    path.resolve(__dirname, '..', 'fuli', 'voice_operator.py'),
    path.resolve(__dirname, '..', '..', 'fuli', 'voice_operator.py')
  ];

  let scriptPath = null;
  for (const p of possibleScriptPaths) {
    if (fs.existsSync(p)) {
      scriptPath = p;
      break;
    }
  }

  if (!scriptPath) {
    logFuli('Voice operator script not found in paths.');
    return;
  }

  const projectDir = path.dirname(path.dirname(scriptPath));

  // Determine uv path cross-platform
  let uvPath = 'uv';
  if (isWin) {
    const winUvPaths = [
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'uv', 'uv.exe'),
      path.join(os.homedir(), '.cargo', 'bin', 'uv.exe')
    ];
    for (const p of winUvPaths) {
      if (fs.existsSync(p)) {
        uvPath = p;
        break;
      }
    }
  } else if (isMac) {
    if (fs.existsSync('/opt/homebrew/bin/uv')) {
      uvPath = '/opt/homebrew/bin/uv';
    } else if (fs.existsSync('/usr/local/bin/uv')) {
      uvPath = '/usr/local/bin/uv';
    }
  }

  logFuli(`Starting voice operator daemon with: ${uvPath} at ${projectDir}`);

  // Kill old zombie processes first
  try {
    const { execSync } = require('child_process');
    if (isWin) {
      execSync('powershell -NoProfile -Command "Get-Process python* -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like \'*voice_operator*\' } | Stop-Process -Force"', { stdio: 'ignore' });
    } else {
      execSync('pkill -f "python.*voice_operator" || true', { stdio: 'ignore' });
    }
  } catch (e) {}

  const { spawn } = require('child_process');
  const spawnEnv = { ...process.env };
  if (isMac) {
    spawnEnv.PATH = `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`;
  }

  voiceProcess = spawn(uvPath, ['run', 'python', '-m', 'fuli.voice_operator'], {
    cwd: projectDir,
    env: spawnEnv,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  voiceProcess.stdout.on('data', (data) => {
    logFuli(`[Voice] ${data.toString().trim()}`);
  });

  voiceProcess.stderr.on('data', (data) => {
    logFuli(`[Voice ERR] ${data.toString().trim()}`);
  });

  voiceProcess.on('exit', (code) => {
    logFuli(`Voice operator exited with code ${code}`);
    voiceProcess = null;
    if (!app.isQuitting) {
      setTimeout(startVoiceOperator, 3000);
    }
  });
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    try {
      app.dock.hide();
    } catch (e) {
      console.warn('Could not hide dock icon:', e);
    }
  }

  // Set seamless launch on system login for background availability
  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: true
    });
  } catch (e) {}

  createWindow();
  createTray();
  startLocalCommandServer();

  // Request macOS microphone permission so Fuli can hear voice commands
  if (process.platform === 'darwin' && systemPreferences && systemPreferences.askForMediaAccess) {
    systemPreferences.askForMediaAccess('microphone').then((granted) => {
      logFuli(`macOS Microphone access granted: ${granted}`);
    }).catch(err => {
      logFuli(`Microphone permission notice: ${err.message}`);
    });
  }

  // Register global shortcuts: Alt+Space (Windows standard), Option+Space (Mac standard), etc.
  const shortcutsToRegister = [
    'Alt+Space',
    'Option+Space',
    'CommandOrControl+Shift+Space',
    'CommandOrControl+Alt+Space'
  ];

  for (const sc of shortcutsToRegister) {
    try {
      const success = globalShortcut.register(sc, () => {
        logFuli(`Global shortcut triggered: ${sc}`);
        toggleWindow();
      });
      logFuli(`Shortcut [${sc}] registered: ${success}`);
    } catch (err) {
      logFuli(`Failed to register shortcut [${sc}]: ${err.message}`);
    }
  }

  // Auto-start voice operator in background so user NEVER has to run a terminal command!
  startVoiceOperator();

  // Show window initially on startup
  showWindow();

  app.on('activate', () => {
    showWindow();
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (voiceProcess) {
    try { voiceProcess.kill('SIGTERM'); } catch (e) {}
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (voiceProcess) {
    try { voiceProcess.kill('SIGKILL'); } catch (e) {}
  }
});

// IPC Handlers
ipcMain.on('fuli:submit-prompt', async (event, prompt) => {
  if (!prompt || !prompt.trim()) return;

  isTaskRunning = true;
  try {
    const result = await actionExecutor.executeTask(prompt.trim(), (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('fuli:progress', progress);
      }
    });

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('fuli:complete', result);
    }
  } catch (err) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('fuli:error', { message: err.message });
    }
  } finally {
    isTaskRunning = false;
  }
});

ipcMain.on('fuli:cancel-task', () => {
  isTaskRunning = false;
  actionExecutor.cancel();
});

ipcMain.on('fuli:hide-window', () => {
  hideWindow();
});

ipcMain.on('fuli:close-app', () => {
  hideWindow();
});

ipcMain.on('fuli:resize-window', (event, { width, height }) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setSize(width || DEFAULT_WIDTH, height || DEFAULT_HEIGHT, true);
  }
});

ipcMain.on('fuli:trigger-mic-listen', () => {
  try {
    http.get('http://127.0.0.1:8766/listen', () => {}).on('error', () => {});
  } catch (e) {}
});
