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
  // Create a minimal 16x16 icon programmatically for the menu bar
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setTitle('⚡ Fuli');
  tray.setToolTip('Fuli — AI Screen & Browser Operator');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Fuli (Cmd+Shift+Space)', click: toggleWindow },
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
    skipTaskbar: true,
    hasShadow: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('blur', () => {
    // Optionally keep open if running a task, otherwise hide
    if (!mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
      // Allow window to stay visible during task execution
    }
  });
}

function toggleWindow() {
  if (!mainWindow) return;

  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('fuli:focus-input');
  }
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  // Register global shortcut: Cmd+Shift+Space
  const ret = globalShortcut.register('CommandOrControl+Shift+Space', toggleWindow);
  if (!ret) {
    console.warn('Global shortcut registration failed');
  }

  // Show window initially on startup
  toggleWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
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

ipcMain.on('fuli:resize-window', (event, { width, height }) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setSize(width || DEFAULT_WIDTH, height || DEFAULT_HEIGHT, true);
  }
});
