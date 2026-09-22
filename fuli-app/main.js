const { app, BrowserWindow, globalShortcut, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { actionExecutor } = require('./automation/executor');

let mainWindow = null;
let tray = null;

const DEFAULT_WIDTH = 680;
const DEFAULT_HEIGHT = 76; // compact prompt bar
const EXPANDED_HEIGHT = 420; // when steps/progress are active

function createTray() {
  const logoPath = path.resolve(__dirname, '../images/Fuli_Logo.png');
  let icon;
  try {
    icon = nativeImage.createFromPath(logoPath).resize({ width: 18, height: 18 });
  } catch (e) {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setTitle(' Fuli');
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
}

function toggleWindow() {
  if (!mainWindow) return;

  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.setAlwaysOnTop(true, 'floating', 1);
    mainWindow.webContents.send('fuli:focus-input');
  }
}

app.whenReady().then(() => {
  const logoPath = path.resolve(__dirname, '../images/Fuli_Logo.png');
  if (process.platform === 'darwin' && app.dock) {
    try {
      const dockIcon = nativeImage.createFromPath(logoPath);
      app.dock.setIcon(dockIcon);
    } catch (e) {
      console.warn('Could not set dock icon:', e);
    }
  }

  createWindow();
  createTray();

  // Register global shortcuts: Cmd+Shift+Space and Option+Space / Alt+Space
  const registered1 = globalShortcut.register('CommandOrControl+Shift+Space', toggleWindow);
  const registered2 = globalShortcut.register('Alt+Space', toggleWindow);

  console.log(`Global shortcut CommandOrControl+Shift+Space registered: ${registered1}`);
  console.log(`Global shortcut Alt+Space registered: ${registered2}`);

  // Show window initially on startup
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('fuli:focus-input');

  app.on('activate', () => {
    toggleWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// IPC Handlers
ipcMain.on('fuli:submit-prompt', async (event, prompt) => {
  if (!prompt || !prompt.trim()) return;

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
  }
});

ipcMain.on('fuli:cancel-task', () => {
  actionExecutor.cancel();
});

ipcMain.on('fuli:hide-window', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
});

ipcMain.on('fuli:close-app', () => {
  app.quit();
});

ipcMain.on('fuli:resize-window', (event, { width, height }) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setSize(width || DEFAULT_WIDTH, height || DEFAULT_HEIGHT, true);
  }
});
