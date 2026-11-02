# Avatar Companion desktop: store prep

Written 2026-11-02 by the desktop track in the `native-shells` worktree of `CI-Spatial-Agent-Web`.
Nothing here has been signed for distribution, notarized, uploaded or submitted to a store.
Read the owner decisions at the end before any build leaves the owner's machine.

## Status

| Item | Status |
| --- | --- |
| Debug `.app` built from the existing `apps/web/dist` snapshot, web build skipped | Builds (exit 0) |
| `Info.plist` contains `NSMicrophoneUsageDescription` | Verified with PlistBuddy |
| Web bundle loads in the webview (`index.html`, JS and CSS fetched with 200) | Verified from inside the webview |
| React UI mounts in the webview (about 26 KB of DOM, 3D canvas present) | Verified from inside the webview |
| Pixels of the window show the UI | Not verified. The macOS session was locked at the last check, and every capture was blank (see Verified and not verified) |
| CSP `connect-src` allows `blob:` (embedded GLTF textures load through blob URLs) | Changed. Checked in a browser against the same policy |
| Window centred on the primary display (`center: true`) | Changed. Not shown to fix anything |
| `src-tauri/Entitlements.plist` wired as `bundle.macOS.entitlements` | Wired. Debug build passes. Unsigned debug builds do not carry it |
| `scripts/desktop-notarize.sh` | Written. Missing-config and identity checks tested. Nothing signed, nothing sent to Apple |
| Windows NSIS target and thumbprint from the environment | Written. `scripts/desktop-build-windows.mjs` env checks tested on macOS. No Windows build |
| Linux `deb` and `AppImage` targets | Written in `src-tauri/tauri.linux.conf.json`. Not built, no Linux host |
| Icons | Validated: PNG sizes, ICNS and ICO structure, `iconutil` parses the ICNS |

## Web-side changes the lead needs

These are not in the desktop track and were not made here.

1. **The WebXR emulator starts inside the desktop webview.** `createXRStore()` in
   `packages/core/src/components/scene/Scene3D.tsx` (line 279) takes the `@pmndrs/xr` defaults. Its
   `emulate` option defaults to `'metaQuest3'`, and the emulator is injected when
   `location.hostname` is `localhost`. The Tauri origin is `tauri://localhost`, so the emulator
   starts in the desktop webview. The probe found `navigator.xr` present and `navigator.userAgent`
   replaced by a Quest 3 string. `useXRLayout` (`packages/core/src/utils/useXRLayout.ts`) can then
   set `isXR` to true without a coarse pointer, and `detectSurfaceSync` reads the same string. The
   browser harness at `127.0.0.1` did not start the emulator, which fits the hostname rule. Suggested
   fix: pass `emulate: false` to `createXRStore` (and to any other call site) when
   `'__TAURI_INTERNALS__' in window`, or behind a native-shell build flag.
2. **Chat and voice calls go to the wrong origin.** `apiUrl()` in `packages/core/src/config/apiBase.ts`
   prefixes `VITE_API_BASE` when it is set. The `apps/web/dist` snapshot was built without it, so
   `/api/chat`, `/api/stt`, `/api/tts`, `/api/talk/token` and `/api/config/telemetry` resolve against
   `tauri://localhost`. Build the bundle the shell loads with `VITE_API_BASE` set to the BFF's absolute
   origin, and add `tauri://localhost` and `http://tauri.localhost` to the BFF's `APP_ALLOWED_ORIGINS`.
   The first of these was not exercised at runtime.
3. No web change is needed for the CSP. The desktop CSP now allows `blob:` in `connect-src`.

## Distribution routes

| | Direct (macOS Developer ID, Windows NSIS, Linux packages) | Mac App Store | Microsoft Store |
| --- | --- | --- | --- |
| Package | `.app` (in a DMG if wanted), NSIS `.exe`, `.deb`, `.AppImage` | `.pkg` from `productbuild`, sandboxed | MSIX (not verified here) |
| Signing | Developer ID Application, hardened runtime, notarized and stapled by `scripts/desktop-notarize.sh`. Authenticode for Windows via `WINDOWS_CERTIFICATE_THUMBPRINT` | Apple Distribution for the app and Mac Installer Distribution for the `.pkg`. The older "3rd Party Mac Developer" names also work. App Sandbox required | Partner Center signs MSIX for the store (not verified here) |
| Review | None by Apple or Microsoft. Gatekeeper and SmartScreen warn on unsigned or unnotarized builds | Apple App Review. Guideline 4.2 (Minimum Functionality) is a rejection risk for a plain web wrapper | Microsoft Store certification |
| Updates | Needs an updater and its own signing key (owner decision) | Store updates | Store updates |
| Fees | Not applicable | Apple program terms | Partner Center terms |

Current store rules and fees were not checked from this environment. Recheck the developer
agreements before any submission.

## Payload: third-party avatar models

Measured 2026-11-02 from `apps/web/dist` (read-only):

- `du` reports 257 MiB (263,484 KiB) for the whole `dist` folder. That is the "about 257 MB"
  figure. In decimal units it is about 270 MB.
- 82 model files (`.glb`, `.vrm`, `.gltf`, `.bin`) total 244.9 MB (233.5 MiB).
- The 10 VRM files under `assets/avatars/vrm/` total 119.0 MB. `NOTICE.md` records their embedded
  terms: redistribution prohibited, author only, or no commercial use. Two are VRoid Hub terms.
- `assets/avatars/humgen-aria-01.vrm` (22.6 MB) is first-party. The other GLB avatars total
  51.4 MB. `NOTICE.md` says they carry no machine-readable licence and need review before any
  redistribution.

Every desktop build copies all of `apps/web/dist` into the binary, so every build carries these
files. Rule for this track: no build leaves the owner's machine (no upload, no shared installer, no
TestFlight or store submission) until a slim store build exists. The slim build must leave out the
restricted models and load avatars from a source the owner controls. It does not exist yet.

## WebXR

WebXR is not available in WKWebView (macOS). The task brief assumes the same for WebView2 (Windows),
which is unverified here. The desktop shell does not change either. The web app's immersive mode
stays on the web. Inside the desktop webview the IWER emulator currently stands in for a Quest 3
headset (web-side change 1), so no real WebXR session is exercised. Do not claim XR support in a
store listing.

## Owner decisions

1. **Bundle identifier.** `computer.ci.avatar` in `tauri.conf.json` is provisional. It becomes the
   App Store Connect and Partner Center identity, and changing it later creates a new app. Pick the
   final value before any signed build.
2. **Signing identities.** The login keychain of the build Mac holds one Developer ID Application
   identity and one Apple Distribution identity. Neither was used. Decide which identities the
   owner intends to use for each route, and where their private keys are held. For Windows, an
   Authenticode certificate's SHA-1 thumbprint goes in `WINDOWS_CERTIFICATE_THUMBPRINT`.
3. **Notarization.** Choose the notary credential: an App Store Connect API key (`APPLE_API_KEY`,
   `APPLE_API_ISSUER`, `APPLE_API_KEY_PATH`) or an Apple ID with an app-specific password
   (`APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`). The API key is preferred because no secret
   goes on the command line.
4. **Licence.** The repository licence is PolyForm Noncommercial 1.0.0, which restricts commercial
   use. Decide whether store distribution is allowed under it, paid or free, or whether a separate
   store licence is needed.
5. **Third-party models.** Decide which models may ship. Under their embedded terms, none of the 10
   VRM files under `assets/avatars/vrm/` may be redistributed for commercial use. The slim store build
   needs replacements or a separate content source.
6. **Updates.** Decide whether direct builds ship an updater. Tauri's updater needs a signing key that
   the owner generates and holds.
7. **Privacy.** Decide the privacy policy URL and the store privacy answers for microphone use.
   `NSMicrophoneUsageDescription` is already in `Info.plist`. Check whether Apple's privacy manifest
   rules apply to this build.
8. **Store review risk.** Apple Guideline 4.2 (Minimum Functionality) can reject an app that mainly
   wraps a website, and the README says the shell adds no native features yet. Decide what native
   value the Mac App Store build adds before submitting.
9. **Emulator and API base.** Decide with the web owner that the desktop build skips the WebXR
   emulator and sets `VITE_API_BASE` (see Web-side changes).

## Commands

From `apps/desktop`:

```sh
pnpm exec tauri build --debug --bundles app --config '{"build":{"beforeBuildCommand":""}}'   # debug .app, web bundle not rebuilt
scripts/desktop-notarize.sh --check                                                         # environment check only, nothing signed
scripts/desktop-notarize.sh "src-tauri/target/release/bundle/macos/Avatar Companion.app"    # sign, notarize, staple (needs owner credentials)
node scripts/desktop-build-windows.mjs                                                      # Windows NSIS, on Windows, needs WINDOWS_CERTIFICATE_THUMBPRINT
pnpm exec tauri build --bundles deb,appimage                                                # Linux, on Linux (not run here)
```

`scripts/desktop-notarize.sh` exits 2 and names the missing variables when they are not set, and it
signs nothing in that case. It never prints values.

## Verified and not verified

Verified on the macOS build host:

- The debug `.app` builds from the existing `apps/web/dist` snapshot. `beforeBuildCommand` is
  overridden to an empty string, and the log shows no web build step.
- The bundle's `Info.plist` has `NSMicrophoneUsageDescription`, `CFBundleIdentifier`
  `computer.ci.avatar`, `LSMinimumSystemVersion` 12.0 and `LSApplicationCategoryType`
  `public.app-category.productivity`.
- The binary embeds the web bundle. Inside the webview, `tauri://localhost/index.html`, the module,
  the stylesheet and `/config.json` all return 200 (the last with an HTML fallback, which the app
  treats as no runtime config). The React tree mounts.
- The icon set is well formed (see Status).
- `desktop-notarize.sh` exits 2 without signing when configuration is missing or the identity is not in the keychain.
- `desktop-build-windows.mjs` exits 2 when the thumbprint is missing or malformed.
- The `tauri.windows.conf.json` and `tauri.linux.conf.json` keys exist in the Tauri CLI config schema.

Not verified:

- **Pixels in the window.** The macOS session was locked at the last check
  (`CGSSessionScreenIsLocked` = `Yes`). In the runs that were probed, WebKit reported the page as
  hidden (`document.visibilityState` was `hidden`, `requestAnimationFrame` did not run) and painted
  nothing. The app is not known to be at fault. Repeat the check from an unlocked session: launch
  `Avatar Companion.app` from `src-tauri/target/debug/bundle/macos/`, keep the window on screen and
  in front, and take a screenshot.
- Windows and Linux builds. There is no Windows or Linux host here.
- Developer ID signing, notarization and stapling. Not run, to avoid sending the app to Apple.
- Mac App Store sandbox behaviour under a real signature. The entitlements were checked only by
  ad-hoc signing a scratch copy.
- WebXR in WKWebView or WebView2.
- Chat and voice against a BFF. Not tested. The `/api/*` calls resolve against `tauri://localhost`
  (web-side change 2).
- Store acceptance by Apple or Microsoft.
