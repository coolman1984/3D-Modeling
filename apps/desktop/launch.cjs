// Pure helpers for the desktop window: where the program files are, how the server is started,
// and how its address is read. Kept apart from main.cjs so they are tested without Electron.
'use strict';
const { join } = require('node:path');

/**
 * The desktop program's own port, apart from the browser version (4600) and the demo (4601).
 * The window keeps display settings per address, so a steady port keeps them across starts.
 */
const DESKTOP_PORT = 4650;

/**
 * Where the bundled server and the built interface live. An installed copy carries them in its
 * resources folder (see stage.mjs); a development run uses the builds inside the repository.
 */
function appFiles({ packaged, resourcesPath, here }) {
  const base = packaged ? join(resourcesPath, 'app') : join(here, 'stage');
  return { server: join(base, 'server.mjs'), web: join(base, 'web') };
}

/**
 * Server arguments. No `--open`: the window shows the program, not a browser. The server stops
 * when the window's pipe closes, so no server is left running after the window is gone. Without a
 * port the server finds a free one from 4600 up.
 */
function serverArgs({ server, web, data, port }) {
  const args = ['--disable-warning=ExperimentalWarning', server, '--static', web, '--data', data, '--stop-with-stdin'];
  return port === undefined ? args : [...args, '--port', String(port)];
}

/**
 * The address from the server's start line ("… is running: http://127.0.0.1:4600"), or undefined.
 * Output arrives in pieces; the line must be complete, or a cut-off port would be read.
 */
function findUrl(output) {
  const match = /running: (http:\/\/127\.0\.0\.1:\d+)\s/.exec(output);
  return match ? match[1] : undefined;
}

/** Only the program's own address opens inside the window; every other link goes to the browser. */
function isOwnPage(target, url) {
  try {
    return new URL(target).origin === new URL(url).origin;
  } catch {
    return false;
  }
}

const escape = (text) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * The page the window shows while the program starts or swaps projects, so a double-click gets an
 * answer at once. Colours and type follow DESIGN.md (cool white-grey page, serif heading).
 */
function statusPage(title, detail) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Atrium</title><style>
:root{color-scheme:light}body{margin:0;height:100vh;display:grid;place-items:center;background:#f4f6f8;color:#0b0d12;
font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}main{text-align:center}
h1{font:400 44px/1.1 Georgia,"Times New Roman",serif;margin:0 0 10px;letter-spacing:-0.01em}
p{margin:0;color:#4b505b}.bar{width:180px;height:2px;margin:22px auto 0;background:#dfe3e8;overflow:hidden}
.bar i{display:block;width:40%;height:100%;background:#1f3bf5;animation:go 1.1s ease-in-out infinite}
@keyframes go{from{transform:translateX(-100%)}to{transform:translateX(250%)}}
@media (prefers-reduced-motion:reduce){.bar i{animation:none;width:100%}}</style></head>
<body><main role="status" aria-live="polite"><h1>${escape(title)}</h1><p>${escape(detail)}</p><div class="bar"><i></i></div></main></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

module.exports = { DESKTOP_PORT, appFiles, serverArgs, findUrl, isOwnPage, statusPage };
