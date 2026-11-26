# Avatar Companion desktop app

A Tauri 2 window around the web app that `apps/web` builds, for Windows, macOS and Linux. The web
build is compiled into the binary (`frontendDist`), so the app loads no remote URL. The shell's one
native behaviour is where links go ([Links](#links)). The window is the system WebView: WebView2 on
Windows, WKWebView on macOS and WebKitGTK 4.1 on Linux.

Version, identifier and bundles are in `src-tauri/tauri.conf.json`, with per-OS additions in
`tauri.windows.conf.json` and `tauri.linux.conf.json`. `tests/native-config.test.mjs` pins them.

## Run and build

```bash
pnpm install                                   # from the repo root
pnpm --filter @ci-avatar/desktop dev           # starts the web dev server on :5173 too
pnpm --filter @ci-avatar/desktop build         # installers for this OS
pnpm --filter @ci-avatar/desktop build:debug   # debug build, quicker
pnpm --filter @ci-avatar/desktop test:native   # config tests
```

Build with Rust 1.95 or later. Rust 1.94.0 fails on macOS 27.2 with Xcode 27.2: the proc-macro libraries it links
are rejected by the system loader. Run `rustup update stable`, or set `RUSTUP_TOOLCHAIN=1.99.1` for one build.

`build` regenerates the icons from `apps/web/public/icons/icon-512.png`, writes the third-party
notices (`npm run notices`, below) and runs `tauri build`, whose `beforeBuildCommand` builds the web
app first. It produces, under `src-tauri/target/release/bundle/`:

| OS | Bundles | Notes |
| --- | --- | --- |
| Windows | `nsis/*-setup.exe`, `msi/*.msi` | Not code-signed. NSIS installs for the current user; the MSI for all users. Both fetch WebView2 if it is missing. |
| macOS | `dmg/*.dmg`, `macos/Avatar Companion.app` | Ad-hoc signed (`signingIdentity: "-"`), not notarized. Pass `--target universal-apple-darwin` for one app for Apple silicon and Intel. |
| Linux | `deb/*.deb`, `rpm/*.rpm` | Build on Ubuntu 22.04 with `libwebkit2gtk-4.1-dev`. No AppImage: it would bundle the LGPL WebKitGTK and GTK libraries. |

## What every build carries

- The web app and all of `assets/`: every avatar, animation and prop, and the studio lighting (one CC0 image,
  so the scene needs no connection to light itself). The owner stated it has permission to redistribute the
  avatars, animations and props on 2026-11-14; `NOTICE.md` credits each file.
- `THIRD-PARTY-NOTICES.txt` and `LICENSE.txt` as bundle resources: in the install folder on Windows (both
  installers), in the app's resource folder under `/usr/lib/` in the deb and rpm, and in
  `Contents/Resources` on macOS.
  `scripts/third-party-notices.mjs` writes them into `src-tauri/notices/` (ignored by git) from
  `pnpm-lock.yaml`, `src-tauri/Cargo.lock` and the asset catalogue in `scripts/third-party/assets.mjs`.
- No API key, server address or analytics ID. Build without any `VITE_*` or `APP_*` variable set, as the
  release workflow insists, or Vite will bake it in.

## Servers

The app starts in demo mode: the avatar, its animations and text chat with the scripted demo responder.
For a language model, open Settings, pick **Proxy** (your BFF's `https://<host>/api/chat`) or **Ollama**
(the server's address), and press **Check connection**.

- The page's origin is `tauri://localhost` on macOS and Linux and `http://tauri.localhost` on Windows. The
  BFF in `apps/proxy` allows both (and `https://tauri.localhost`) by default.
- The content security policy lets the app reach servers over HTTPS and over plain HTTP on the same
  computer (`localhost`, `127.0.0.1`); `tests/native-config.test.mjs` pins that.
- Ollama allows `tauri://localhost` by default. For the Windows app, set `OLLAMA_ORIGINS=http://tauri.localhost`.

## Links

The app's own pages stay in the window: `tauri://localhost`, `http(s)://tauri.localhost`, and the Vite
dev server under `tauri dev`. Any other `http`, `https` or `mailto` link opens in the system browser or
mail client, and the window stays where it was. That holds for a plain link, a `target="_blank"` link
and `window.open` alike. Without it, a plain link would replace the app with the web page and leave no
way back, and a `target="_blank"` link would do nothing.

`src-tauri/src/main.rs` does this. The window is declared in `tauri.conf.json` with `create: false` and
built in `setup()`, so that `on_navigation` and `on_new_window` can be attached to it; both hand the link
to `tauri-plugin-opener` and cancel it, and no second app window ever opens. The plugin's own click
script is turned off (`open_js_links_on_click(false)`): it would send `target="_blank"` links to the
plugin's `open_url` command, which the page is not granted, so they would do nothing. `cargo test` (in
`src-tauri`) checks the URL rules; `tests/native-config.test.mjs` checks the wiring.

## Limits

- WebXR is not available in any of the system WebViews, so immersive mode stays on the web.
- On-device models (WebLLM) do not run here: a worker imports the engine from a CDN (esm.run), and the
  app's content security policy blocks that import (checked in Chromium with the same policy). Bundling
  the engine with the app would fix it without loosening the policy.
- There is no updater: install a new release over the old one.
- `identifier` is `computer.ci.avatar`, which v0.2.0 ships with. Changing it later moves the app's data
  folder, so users would lose their settings; the owner decides before any store or signed release
  (`STORE-PREP.md`).

## Releases

`.github/workflows/native-release.yml` builds all three systems on GitHub's runners (Windows NSIS and MSI,
a universal ad-hoc signed macOS dmg, Linux deb and rpm) with the Android APK and publishes a GitHub
pre-release. It starts each app for 15 seconds as a smoke test. See the root `README.md`.

Store and signed distribution (Developer ID and notarization with `scripts/desktop-notarize.sh`,
Authenticode with `scripts/desktop-build-windows.mjs`, the Mac App Store) are in `STORE-PREP.md`. The Snap,
Homebrew, Scoop and winget packaging is in [docs/PUBLISHING.md](../../docs/PUBLISHING.md).
