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

const LOG_FILE = '/tmp/fuli_app.log';
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

  const contextMenu = Menu.buildFromTemplate([
    { label: '⚡ Show / Hide Fuli (Cmd+Shift+Space)', click: toggleWindow },
    { type: 'separator' },
    { label: 'Quit Fuli', click: () => app.quit() }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', toggleWindow);
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth } = primaryDisplay.workAreaSize;

  const x = Math.round((screenWidth - DEFAULT_WIDTH) / 2);
  const y = 140; // Pin near top like Spotlight / Raycast

  mainWindow = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    x: x,
    y: y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: false,
    hasShadow: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Ensure true floating always-on-top on macOS across desktops/spaces
  mainWindow.setAlwaysOnTop(true, 'floating', 1);
  if (mainWindow.setVisibleOnAllWorkspaces) {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  // Auto-dismiss on click outside (Spotlight behavior) when idle
  mainWindow.on('show', () => {
    allowBlurHide = false;
    focusTimestamp = Date.now();
  });

  mainWindow.on('focus', () => {
    focusTimestamp = Date.now();
    // Only allow blur to hide after being focused for at least 400ms
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

  // Never destroy window on close; hide it so Option+Space always works
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

  if (process.platform === 'darwin') {
    app.focus({ steal: true });
  }

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setAlwaysOnTop(true, 'floating', 1);

  // Re-center on active display
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth } = primaryDisplay.workAreaSize;
  const x = Math.round((screenWidth - DEFAULT_WIDTH) / 2);
  mainWindow.setPosition(x, 140);

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
    path.join(os.homedir(), 'VS-Code/AI_Assistant_Fuli/fuli/voice_operator.py'),
    path.resolve(__dirname, '../fuli/voice_operator.py'),
    path.resolve(__dirname, '../../fuli/voice_operator.py')
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
  const uvPath = fs.existsSync('/opt/homebrew/bin/uv') ? '/opt/homebrew/bin/uv' : 'uv';

  logFuli(`Starting voice operator daemon with: ${uvPath} at ${projectDir}`);

  // Kill old zombie processes first
  try {
    const { execSync } = require('child_process');
    execSync('pkill -f "python.*voice_operator" || true');
  } catch (e) {}

  const { spawn } = require('child_process');
  voiceProcess = spawn(uvPath, ['run', 'python', '-m', 'fuli.voice_operator'], {
    cwd: projectDir,
    env: {
      ...process.env,
      PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`
    },
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
  const iconPath = path.resolve(__dirname, 'renderer/assets/icon-128.png');
  if (process.platform === 'darwin' && app.dock) {
    try {
      const dockIcon = nativeImage.createFromPath(iconPath);
      app.dock.setIcon(dockIcon);
    } catch (e) {
      console.warn('Could not set dock icon:', e);
    }
  }

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

  // Register global shortcuts: Alt+Space, Option+Space, Cmd+Shift+Space, Cmd+Alt+Space
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
