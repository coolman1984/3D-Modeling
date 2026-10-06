// Pure helpers for the desktop window: where the program files are, how the server is started,
// and how its address is read. Kept apart from main.cjs so they are tested without Electron.
'use strict';
const { join } = require('node:path');

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
 * when the window's pipe closes, so no server is left running after the window is gone.
 */
function serverArgs({ server, web, data }) {
  return ['--disable-warning=ExperimentalWarning', server, '--static', web, '--data', data, '--stop-with-stdin'];
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

module.exports = { appFiles, serverArgs, findUrl, isOwnPage };
