// Atrium (Space Planner) as a desktop program: one window, no browser. It starts the same local server the
// start files use (with Electron's own Node, which carries the built-in SQLite), waits for its
// address, and shows it. Closing the window stops the server. Decision 0026.
'use strict';
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { appFiles, serverArgs, findUrl, isOwnPage } = require('./launch.cjs');

const START_LIMIT_MS = 60_000;
let server;
let window;
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit(); // a second double-click brings the open window forward instead
} else {
  app.on('second-instance', () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.whenReady().then(start);
}

function dataDir() {
  const dir = join(app.getPath('userData'), 'data');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function startServer(data) {
  const files = appFiles({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, here: __dirname });
  return new Promise((resolve, reject) => {
    let output = '';
    server = spawn(process.execPath, serverArgs({ ...files, data }), {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const timer = setTimeout(() => reject(new Error(`The program did not start in time.\n\n${output}`)), START_LIMIT_MS);
    const read = (chunk) => {
      output = (output + chunk.toString()).slice(-4000);
      const url = findUrl(output);
      if (url) {
        clearTimeout(timer);
        resolve(url);
      }
    };
    server.stdout.on('data', read);
    server.stderr.on('data', read);
    server.on('error', (error) => reject(error));
    server.on('exit', (code) => {
      clearTimeout(timer);
      if (!quitting) {
        reject(new Error(`The program stopped (code ${code}).\n\n${output}`));
        if (window) {
          dialog.showErrorBox('Atrium', `The program stopped unexpectedly.\n\n${output.slice(-1500)}`);
          app.quit();
        }
      }
    });
  });
}

function menu(data) {
  return Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'Open projects folder', click: () => shell.openPath(data) },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
  ]);
}

async function start() {
  const data = dataDir();
  let url;
  try {
    url = await startServer(data);
  } catch (error) {
    dialog.showErrorBox('Atrium could not start', error instanceof Error ? error.message : String(error));
    quitting = true;
    app.quit();
    return;
  }
  Menu.setApplicationMenu(menu(data));
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Atrium',
    backgroundColor: '#f4f6f8',
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  window.once('ready-to-show', () => {
    window.maximize();
    window.show();
  });
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isOwnPage(target, url)) return { action: 'allow' };
    void shell.openExternal(target);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, target) => {
    if (isOwnPage(target, url)) return;
    event.preventDefault();
    void shell.openExternal(target);
  });
  window.on('closed', () => {
    window = undefined;
  });
  await window.loadURL(url);
}

// Close the store cleanly: end the pipe, give the server a moment, then make sure it is gone.
app.on('before-quit', (event) => {
  quitting = true;
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  event.preventDefault();
  const force = setTimeout(() => server.kill(), 3000);
  server.once('exit', () => {
    clearTimeout(force);
    app.quit();
  });
  server.stdin.end();
});

app.on('window-all-closed', () => app.quit());
