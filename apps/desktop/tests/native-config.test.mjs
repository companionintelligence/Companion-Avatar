import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(path.join(here, '../src-tauri/tauri.conf.json'), 'utf8'));
const pkg = JSON.parse(await readFile(path.join(here, '../package.json'), 'utf8'));

test('Avatar desktop loads its bundled web app and not the hosted website', () => {
  assert.equal(config.productName, 'Avatar Companion');
  assert.equal(config.identifier, 'computer.ci.avatar');
  assert.equal(config.build.devUrl, 'http://localhost:5173');
  assert.equal(path.basename(config.build.frontendDist), 'dist');
  assert.equal(config.build.serverUrl, undefined);
});

test('Avatar desktop CSP allows the WebAssembly and media required by the scene', () => {
  const csp = config.app.security.csp;
  assert.match(csp, /script-src[^;]*wasm-unsafe-eval/);
  assert.match(csp, /media-src[^;]*blob:/);
  assert.match(csp, /connect-src[^;]*https:/);
});

test('desktop build generates all required platform icons', () => {
  assert.deepEqual(config.bundle.icon, ['icons/32x32.png', 'icons/128x128.png', 'icons/128x128@2x.png', 'icons/icon.icns', 'icons/icon.ico']);
  assert.match(pkg.scripts.icons, /^tauri icon /);
  assert.match(pkg.scripts.build, /npm run icons && tauri build/);
});
