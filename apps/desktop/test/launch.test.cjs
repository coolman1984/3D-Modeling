'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { appFiles, serverArgs, findUrl, isOwnPage } = require('../launch.cjs');

test('an installed copy reads its files from resources/app; a development run from stage/', () => {
  assert.deepEqual(appFiles({ packaged: true, resourcesPath: join('R'), here: 'H' }), {
    server: join('R', 'app', 'server.mjs'),
    web: join('R', 'app', 'web'),
  });
  assert.equal(appFiles({ packaged: false, resourcesPath: 'R', here: 'H' }).server, join('H', 'stage', 'server.mjs'));
});

test('the server never opens a browser and stops with the window', () => {
  const args = serverArgs({ server: 's.mjs', web: 'w', data: 'd' });
  assert.equal(args.includes('--open'), false);
  assert.equal(args.includes('--stop-with-stdin'), true);
  assert.deepEqual(args.slice(1, 6), ['s.mjs', '--static', 'w', '--data', 'd']);
});

test('the address is read from the start line, also when the port moved', () => {
  assert.equal(findUrl('\n  Atrium is running: http://127.0.0.1:4603\n  Data is kept in: x'), 'http://127.0.0.1:4603');
  assert.equal(findUrl('  Atrium is running: http://127.0.0.1:46'), undefined); // cut off: wait for the rest
  assert.equal(findUrl('starting'), undefined);
});

test('only the program\'s own pages stay in the window', () => {
  const url = 'http://127.0.0.1:4600';
  assert.equal(isOwnPage('http://127.0.0.1:4600/project/abc', url), true);
  assert.equal(isOwnPage('http://127.0.0.1:4601/', url), false);
  assert.equal(isOwnPage('https://nodejs.org', url), false);
  assert.equal(isOwnPage('not a url', url), false);
});
