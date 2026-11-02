# Avatar Companion desktop shell

A Tauri 2 window around the same web app that `apps/web` builds. It adds no native
features yet. Its job is to prove the wrap builds on macOS, Windows and Linux.

## Run

```bash
pnpm install                                   # from the repo root
pnpm --filter @ci-avatar/desktop dev           # starts the web dev server on :5173 too
pnpm --filter @ci-avatar/desktop build:debug   # debug .app, no installer
```

Chat and voice call the BFF proxy, so start `pnpm dev:proxy` alongside the dev shell.

## Limits

- The window is the system WebView (WKWebView on macOS, WebView2 on Windows, WebKitGTK on
  Linux). WebXR is not available in any of them, so immersive mode stays on the web.
- `identifier` (`computer.ci.avatar`) and the CSP in `tauri.conf.json` are provisional. The
  owner picks the real bundle identifier before any signed release.
- The window loads the bundled `apps/web/dist`, which contains every third-party avatar
  model. See the wrapping plan before any distribution.
