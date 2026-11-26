import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(path.join(here, '../src-tauri/tauri.conf.json'), 'utf8'));
const pkg = JSON.parse(await readFile(path.join(here, '../package.json'), 'utf8'));
const cargoToml = await readFile(path.join(here, '../src-tauri/Cargo.toml'), 'utf8');
const cargoLock = await readFile(path.join(here, '../src-tauri/Cargo.lock'), 'utf8');
const mainRs = await readFile(path.join(here, '../src-tauri/src/main.rs'), 'utf8');
const toolchainToml = await readFile(path.join(here, '../src-tauri/rust-toolchain.toml'), 'utf8');
const releaseWorkflow = await readFile(path.join(here, '../../../.github/workflows/native-release.yml'), 'utf8');

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

test('Avatar desktop CSP lets the user pick a server on this computer or over HTTPS', () => {
  // Settings takes a Proxy (BFF) or Ollama URL at run time. A server on the same computer is
  // typed as localhost or 127.0.0.1; anything further away needs HTTPS, as on the web.
  const connect = config.app.security.csp.match(/connect-src([^;]*)/)[1].trim().split(/\s+/);
  for (const source of ['https:', 'wss:', 'http://localhost:*', 'ws://localhost:*', 'http://127.0.0.1:*', 'ws://127.0.0.1:*']) {
    assert.ok(connect.includes(source), `connect-src lacks ${source}`);
  }
  assert.ok(!connect.includes('http:') && !connect.includes('*'), 'connect-src must not allow every plain-http host');
});

test('links out of the app open in the system browser, and the window stays on the app', async () => {
  // The window is built in Rust (src/main.rs), because the link handlers can only be attached to a
  // builder; Tauri must not also create it from the config.
  assert.equal(config.app.windows.length, 1);
  const [main] = config.app.windows;
  assert.equal(main.label, 'main');
  assert.equal(main.create, false);
  assert.match(mainRs, /WebviewWindowBuilder::from_config\(/);
  assert.match(mainRs, /\.on_navigation\(/);
  assert.match(mainRs, /\.on_new_window\(/);
  assert.match(mainRs, /NewWindowResponse::Deny/);
  assert.match(mainRs, /\.opener\(\)\.open_url\(/);
  // The plugin's own click script would send target="_blank" links to its open_url command, which
  // the page is not granted, so they would do nothing; on_new_window opens them instead.
  assert.match(mainRs, /tauri_plugin_opener::Builder::new\(\)\s*\.open_js_links_on_click\(false\)\s*\.build\(\)/);
  assert.doesNotMatch(mainRs, /tauri_plugin_opener::init\(\)/);
  const capability = JSON.parse(await readFile(path.join(here, '../src-tauri/capabilities/default.json'), 'utf8'));
  assert.deepEqual(capability.windows, ['main']);
  assert.deepEqual(capability.permissions, ['core:default']);
});

test('the opener plugin is tauri-plugin-opener 2.7.3 in Cargo.toml and Cargo.lock', () => {
  assert.match(cargoToml, /^tauri-plugin-opener = "2\.7\.3"$/m);
  const locked = [...cargoLock.matchAll(/^\[\[package\]\]\r?\nname = "tauri-plugin-opener"\r?\nversion = "([^"]+)"/gm)].map((m) => m[1]);
  assert.deepEqual(locked, ['2.7.3']);
});

test('desktop builds bundle the committed icons and leave them alone', () => {
  assert.deepEqual(config.bundle.icon, ['icons/32x32.png', 'icons/128x128.png', 'icons/128x128@2x.png', 'icons/icon.icns', 'icons/icon.ico']);
  // `tauri icon` regenerates them on request only. Run inside every build, it rewrote seven
  // tracked files with re-sampled pixels each time, and the release workflow, which calls
  // `tauri build` directly, shipped the committed ones anyway.
  assert.match(pkg.scripts.icons, /^tauri icon /);
  assert.equal(pkg.scripts.build, 'npm run notices && tauri build');
  assert.equal(pkg.scripts['build:debug'], 'npm run notices && tauri build --debug');
});

test('the desktop crate pins Rust 1.99.1 or later, which builds on macOS 27.2.1', () => {
  const channel = toolchainToml.match(/^channel = "([^"]+)"$/m)?.[1];
  assert.ok(channel, 'rust-toolchain.toml names no channel');
  const [major, minor] = channel.split('.').map(Number);
  // 1.94.0 and 1.95.0 build proc-macro libraries the macOS 27.2.1 loader refuses (docs/DEVICE-QA.md, finding 1).
  assert.ok(major > 1 || (major === 1 && minor >= 99), `channel ${channel} is older than 1.99`);
});

test('the release workflow gives the pinned toolchain the macOS cross targets', () => {
  // Targets added to stable alone are not seen by cargo in src-tauri, which uses the pinned one.
  assert.match(releaseWorkflow, /rustup toolchain install "\$pinned"/);
  assert.match(releaseWorkflow, /rustup target add --toolchain "\$pinned" \$RUST_TARGETS/);
});

test('desktop bundles carry the third-party notices and the licence', () => {
  // scripts/third-party-notices.mjs writes both files into src-tauri/notices before every build.
  assert.deepEqual(config.bundle.resources, {
    'notices/THIRD-PARTY-NOTICES.txt': 'THIRD-PARTY-NOTICES.txt',
    'notices/LICENSE.txt': 'LICENSE.txt'
  });
  assert.match(pkg.scripts.notices, /third-party-notices\.mjs --parts web,assets,desktop --out src-tauri\/notices$/);
  for (const script of ['dev', 'build', 'build:debug']) assert.match(pkg.scripts[script], /npm run notices && tauri /);
});

test('desktop version is the same in tauri.conf.json, Cargo.toml and package.json', () => {
  // The release workflow names the installers after tauri.conf.json's version and checks the tag
  // against it; Cargo.toml and package.json must not drift from it.
  const cargoVersion = cargoToml.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1];
  assert.match(config.version, /^\d+\.\d+\.\d+$/);
  assert.equal(cargoVersion, config.version);
  assert.equal(pkg.version, config.version);
});

test('desktop release bundles: NSIS and MSI, deb and rpm without AppImage, ad-hoc signed macOS', async () => {
  const windows = JSON.parse(await readFile(path.join(here, '../src-tauri/tauri.windows.conf.json'), 'utf8'));
  const linux = JSON.parse(await readFile(path.join(here, '../src-tauri/tauri.linux.conf.json'), 'utf8'));
  assert.deepEqual(windows.bundle.targets, ['nsis', 'msi']);
  // No AppImage: it would bundle the LGPL WebKitGTK and GTK libraries into the download.
  assert.deepEqual(linux.bundle.targets, ['deb', 'rpm']);
  // "-" is an ad-hoc signature: Apple silicon needs one to run the app at all. Developer ID
  // signing (scripts/desktop-notarize.sh, APPLE_SIGNING_IDENTITY) replaces it.
  assert.equal(config.bundle.macOS.signingIdentity, '-');
  assert.equal(windows.bundle.windows.certificateThumbprint, null);
});
