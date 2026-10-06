// Atrium (Space Planner) as a desktop program: one window, no browser. It starts the same local
// server the start files use (with Electron's own Node, which carries the built-in SQLite), waits
// for its address, and shows it. Closing the window stops the server. Decision 0026.
'use strict';
const { app, BrowserWindow, Menu, dialog, session, shell } = require('electron');
const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, writeFileSync } = require('node:fs');
const { createServer } = require('node:net');
const { join } = require('node:path');
const { DESKTOP_PORT, appFiles, serverArgs, findUrl, isOwnPage, statusPage } = require('./launch.cjs');
const { DB, ImportError, countProjects, prepareCopy, putBack, swapIn } = require('./projects.cjs');

const START_LIMIT_MS = 60_000;
const STOP_LIMIT_MS = 5_000;

let server; // the running server process
let url; // its address
let window;
let quitting = false;
let busy = false; // an import is swapping the projects

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

const dataDir = () => {
  const dir = join(app.getPath('userData'), 'data');
  mkdirSync(dir, { recursive: true });
  return dir;
};
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

/** The desktop port when it is free; otherwise none, and the server finds one. */
function freePort(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(undefined));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(port)));
  });
}

async function startServer() {
  const files = appFiles({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, here: __dirname });
  const port = await freePort(DESKTOP_PORT);
  return new Promise((resolve, reject) => {
    let output = '';
    let started = false;
    const child = spawn(process.execPath, serverArgs({ ...files, data: dataDir(), port }), {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    server = child;
    const fail = (message) => {
      clearTimeout(timer);
      reject(Object.assign(new Error(message), { output }));
    };
    const timer = setTimeout(() => fail('The program did not start within a minute.'), START_LIMIT_MS);
    const read = (chunk) => {
      output = (output + chunk.toString()).slice(-8000);
      const found = !started && findUrl(output);
      if (found) {
        started = true;
        clearTimeout(timer);
        resolve(found);
      }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('error', (error) => fail(error.message));
    child.on('exit', (code) => {
      if (!started) return fail(`The program stopped while starting (code ${code}).`);
      if (quitting || child.stopping) return;
      // It stopped by itself while in use: say so plainly and offer the way back.
      showProblem('Atrium stopped unexpectedly', 'Your work up to the last change is saved. Start Atrium again to continue.', output);
      app.quit();
    });
  });
}

/** Stops the server and waits for it to close the projects file cleanly. */
function stopServer() {
  const child = server;
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  child.stopping = true;
  return new Promise((resolve) => {
    const force = setTimeout(() => child.kill(), STOP_LIMIT_MS);
    child.once('exit', () => {
      clearTimeout(force);
      resolve();
    });
    child.stdin.end();
  });
}

/** A plain message for the person; the technical detail goes to a log file next to the projects. */
function showProblem(title, message, output) {
  let where = '';
  if (output) {
    try {
      const log = join(app.getPath('userData'), 'last-problem.log');
      writeFileSync(log, output);
      where = `\n\nDetails for support are in:\n${log}`;
    } catch {
      // The message still helps without the log.
    }
  }
  const options = { type: 'error', title, message: title, detail: message + where };
  if (window) dialog.showMessageBoxSync(window, options);
  else dialog.showMessageBoxSync(options);
}

function status(title, detail) {
  if (window) void window.loadURL(statusPage(title, detail));
}

async function bringProjects() {
  if (busy || !window) return;
  const chosen = dialog.showOpenDialogSync(window, {
    title: 'Bring projects from another copy of Atrium',
    buttonLabel: 'Bring projects',
    properties: ['openFile'],
    filters: [{ name: 'Atrium projects', extensions: ['db'] }],
  });
  if (!chosen) return;
  const data = dataDir();
  busy = true;
  let prepared;
  let swapping = false;
  try {
    const here = countProjects(join(data, DB)) ?? 0;
    const there = countProjects(chosen[0]);
    const plural = (n) => `${n} project${n === 1 ? '' : 's'}`;
    if (here > 0) {
      const answer = dialog.showMessageBoxSync(window, {
        type: 'question',
        title: 'Bring projects',
        message: `Use the ${plural(there)} from that copy instead of the ${plural(here)} here?`,
        detail: 'The projects here are kept as a backup in the projects folder (File → Open projects folder → backups), so nothing is lost.',
        buttons: ['Use those projects', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
      });
      if (answer !== 0) return;
    }
    const when = stamp();
    prepared = prepareCopy(chosen[0], data, when);
    swapping = true;
    status('Bringing your projects', `${plural(prepared.projects)} on the way…`);
    await stopServer();
    const kept = swapIn(data, prepared.temp, when);
    prepared = undefined;
    try {
      url = await startServer();
    } catch (refused) {
      // The file is sound but this version cannot open it (say, it came from a newer version):
      // put the projects that were here back, so the program never stays unable to start.
      await stopServer();
      putBack(data, kept, when);
      throw new ImportError('This version of Atrium cannot open those projects. Update Atrium on this computer, then try again.', refused);
    }
    await window.loadURL(url);
  } catch (error) {
    const plain = error instanceof ImportError ? error.message : 'The projects could not be brought in.';
    showProblem('Projects not brought in', `${plain}\nYour projects here are unchanged.`, error instanceof ImportError ? undefined : String(error?.output ?? error?.stack ?? error));
    if (server?.exitCode !== null || server?.signalCode !== null) {
      try {
        url = await startServer();
      } catch (again) {
        showProblem('Atrium could not start', 'Start Atrium again.', String(again?.output ?? again));
        app.quit();
        return;
      }
    }
    if (window && swapping) await window.loadURL(url);
  } finally {
    if (prepared) require('node:fs').rmSync(prepared.temp, { force: true });
    busy = false;
  }
}

/** Once, on a new computer with no projects: offer to bring the ones from the browser version. */
async function welcome() {
  const data = dataDir();
  const marker = join(app.getPath('userData'), 'welcomed');
  if (existsSync(marker)) return;
  writeFileSync(marker, '');
  if ((countProjects(join(data, DB)) ?? 0) > 0) return;
  const answer = await dialog.showMessageBox(window, {
    type: 'question',
    title: 'Welcome to Atrium',
    message: 'Do you have projects from the browser version of Atrium?',
    detail:
      'Bring them in now: choose the file “planner.db” in the “data” folder of that copy (next to its start file).\n\nYou can do this later from File → Bring projects from another copy.',
    buttons: ['Bring my projects', 'Start fresh'],
    defaultId: 0,
    cancelId: 1,
  });
  if (answer.response === 0) await bringProjects();
}

function menu() {
  return Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'Bring projects from another copy…', click: () => void bringProjects() },
        { label: 'Open projects folder', click: () => void shell.openPath(dataDir()) },
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
  Menu.setApplicationMenu(menu());
  // Only the program's own pages may ask for anything (clipboard, notifications …).
  session.defaultSession.setPermissionRequestHandler((contents, _permission, allow) => allow(Boolean(url) && isOwnPage(contents.getURL(), url)));
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
    if (url && isOwnPage(target, url)) return { action: 'allow' };
    if (/^https?:/.test(target)) void shell.openExternal(target);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, target) => {
    if (url && isOwnPage(target, url)) return;
    event.preventDefault();
    if (/^https?:/.test(target)) void shell.openExternal(target);
  });
  window.on('closed', () => {
    window = undefined;
  });
  await window.loadURL(statusPage('Atrium', 'Opening your projects…'));
  try {
    url = await startServer();
  } catch (error) {
    showProblem('Atrium could not start', 'Close any other copy of Atrium and start it again. If it keeps happening, send the details file below.', String(error?.output ?? error));
    quitting = true;
    app.quit();
    return;
  }
  await window.loadURL(url);
  await welcome();
}

// Close the projects file cleanly before leaving: end the pipe, wait for the server, then quit.
app.on('before-quit', (event) => {
  quitting = true;
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  event.preventDefault();
  void stopServer().then(() => app.quit());
});

app.on('window-all-closed', () => app.quit());
