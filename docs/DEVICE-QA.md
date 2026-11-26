# Device QA: web, desktop, iOS and Android against a backend

Run on 2026-11-24 from `main` at `06567c4`, plus the Settings keyboard fix in this branch. (#227 landed
afterwards: these builds still fetched the studio lighting from a CDN, and the apps now ship it.) Every
target was built from source and started, and all but the macOS desktop app were pointed at a real
backend. Nothing was signed with a release key, notarized, uploaded or submitted anywhere. What was
not run is listed at the end, and the table says so where a cell is empty.

## Result

| Target | Built | Ran | Backend chat | Verdict |
| --- | --- | --- | --- | --- |
| Web | `pnpm --filter @ci-avatar/web build`, 17 s, `dist` 276 MB | Production build served by `vite preview`: onboarding, avatar, Settings, connection check | Streamed reply | Pass |
| macOS desktop (Tauri 2, Apple silicon) | `tauri build --bundles app,dmg`, about 4 min on Rust 1.99.1. App 157 MiB, dmg 155 MiB, ad-hoc signed | Launches, window shows the avatar and HUD ([capture](media/device-qa/macos-desktop.jpg)) | Not run (see below) | Partial |
| iOS Simulator (iPhone 17, iOS 27.0) | Debug build for the simulator, app 262 MB | Onboarding, avatar, Settings, connection check ([main](media/device-qa/ios-main.jpg), [chat](media/device-qa/ios-chat.jpg)) | Streamed reply, once the proxy allows `capacitor://localhost` | Pass, three findings |
| iPhone 17 Pro Max (physical) | Debug build signed with the team's existing wildcard development profile, 259 MB | Starts at once; WebGL2 on the Apple GPU at 60.6 fps with the avatar; safe areas 62 px at the top and 34 px at the bottom | Reply in 4.4 s over HTTPS (the phone on the tailnet); connection check **Chat-only** | Pass. Driven by a script, not by hand, so there is no screenshot and the keyboard was not exercised |
| Android emulator (API 36.1, WebView 157) | Debug APK 185 MB. Release APK 181 MB and AAB 181 MB, signed with a throwaway key | Onboarding, avatar, Settings, connection check ([chat](media/device-qa/android-chat.jpg)) | Streamed reply over HTTPS | Pass |
| Windows, Linux | Not built here. The v0.2.0 pre-release carries NSIS, MSI, deb and rpm built by CI | Not run | Not run | Not tested |

The macOS desktop backend check was not run because driving the app's window needs screen control,
which was declined. What is established without it: the proxy answers a preflight from
`tauri://localhost`, `http://tauri.localhost` and `https://tauri.localhost`, and the app's content
security policy allows HTTPS and plain HTTP to `localhost` and `127.0.0.1`.

## Backend and method

- Backend: Ollama 0.33.3 serving `gemma3:1b`, behind the proxy in `apps/proxy` (`APP_UPSTREAM=ollama`).
  The proxy reported `status: degraded` throughout because no text-to-speech server was running, so
  the app's connection check said **Chat-only**: chat reachable, voice unavailable. That is the
  intended wording, not a failure.
- Web reached the proxy directly. The phones reached it over HTTPS through a tailnet-only Tailscale
  Serve port: the Android app has cleartext traffic off and loads from an HTTPS origin, so it only
  talks to HTTPS servers, and the iOS run used HTTPS too.
- The physical iPhone was driven by a QA-only script injected into the gitignored synced copy of the web
  app, because nothing here can tap a phone. It clicks through the same Settings flow in the page and
  writes each step into the app's storage, which was then read back off the device. It is in no commit,
  and the phone now holds a clean build with its data wiped. The script was first run against the web
  build in headless Chromium to prove it.
- The simulator and emulator were driven by tapping through the app's own Settings: pick **Proxy**, type
  the URL, **Check connection**, **Save**, send a message. The app does not talk to a backend until the check has passed in the
  current session, so seeding the saved settings is not enough.
- The apps ran on a Mac with a load average above 500, from other work and from these builds. On the
  iOS Simulator the first launches showed a white screen for several minutes while Rust, Gradle and
  Xcode were building in parallel. Once the builds finished it took 5 to 6 seconds, at the same load.
  That is starvation, not an app defect, but it is why a first iOS launch on a busy machine can look
  hung.

## Findings

| # | Target | Finding | Status |
| --- | --- | --- | --- |
| 1 | macOS desktop build | Rust 1.94.0 on macOS 27.2 with Xcode 27.2 builds proc-macro libraries that the system loader refuses ("mis-aligned LINKEDIT string pool"), so `tauri build` fails inside `serde`, `phf` and `derive_more`. Rust 1.93.1, 1.95 and 1.99.1 build and load them. On 2026-11-25, on macOS 27.2.1, 1.95.0 failed the same way and 1.99.1 built the app. | Worked around: `rustup update stable`, or `RUSTUP_TOOLCHAIN=1.99.1` for one build. Written into the README prerequisites. |
| 2 | iOS | The proxy sends no CORS headers to `capacitor://localhost`, so with default settings the check fails with "Session: Unverified, Load failed". The operator has to list the origin in `APP_ALLOWED_ORIGINS`, as `docs/DEPLOYMENT.md` says. | **Owner decision:** allow it by default like the Android and desktop origins? `apps/proxy/test/cors.test.ts` pins today's refusal on purpose. The "Load failed" text also tells a user nothing. |
| 3 | iOS | The server address, model and avatar URL fields autocorrected: a word in the host name, `ulmer`, became `ulcer`, with a spell-check underline. | **Fixed here**, with a test: those fields now turn autocorrect, autocapitalize and spellcheck off and ask for the URL keyboard. Confirmed on the simulator. |
| 4 | iOS | After a text field has had focus and loses it, `visualViewport.height` and `innerHeight` stay 88 px short (786 against a layout height of 874). The Settings sheet's pinned Save and Cancel are then off-screen until the device is rotated. Seen with the simulator's hardware-keyboard bar and with the on-screen keyboard. | Open. Not fixed here because it was not checked by hand on the real phone, and the simulator may be at fault. Possibly related to the "avatar shifts under the status bar when the keyboard opens" item in `docs/store-readiness.md`. |
| 5 | iOS, Android | After a relaunch the saved backend is not used until **Check connection** has run again: the avatar answers "I am not connected yet. Open Settings and run Check connection before we talk." | Observation. It looks deliberate ("connection truth"), but a store reviewer or a new user will hit it. |
| 6 | Android | On the emulator's host-GPU mode the console fills with `texture bound to texture unit 1 is not renderable` once per frame, and with `Failed to create WebGPU Context Provider`. The scene renders correctly. | Observation. Check on a physical Android device. |
| 7 | macOS desktop | The window opened with the microphone already on ("Starting…") and no onboarding sheet, most likely because the app's stored data from an earlier run had onboarding marked done. The macOS microphone prompt was not observed. | Not verified. |
| 8 | CI | `native-build.yml` has never run on GitHub. The release workflow has: run 43676114486 succeeded on 2026-11-15. | Not verified. |
| 9 | iOS | The project's version is 1.0, build 1, which is the live App Store version, so the next upload needs a higher one. | Owner decision, in [PUBLISHING.md](PUBLISHING.md). |

## Release artifacts checked

- **Android release.** `apksigner verify` passes (v2 scheme) for the APK signed with a throwaway key;
  `zipalign -c -P 16 4` passes; `aapt2` reports package `com.companionintelligence.avatar`,
  versionCode 2, versionName 0.2.0, target SDK 36, permissions `INTERNET`, `RECORD_AUDIO`,
  `MODIFY_AUDIO_SETTINGS`, not debuggable, `allowBackup=false`. Third-party notices are inside the APK.
- **macOS.** `codesign -dv` reports an ad-hoc signature, identifier `computer.ci.avatar`, a thin arm64
  binary in this local build (CI builds the universal one), `NSMicrophoneUsageDescription` present,
  and both licence files in the bundle.
- **iOS.** `ios-archive.sh --unsigned` builds a Release archive: 259 MB, arm64, iPhone and iPad,
  minimum iOS 15.0, version 1.0 (build 1), `ITSAppUsesNonExemptEncryption` false, microphone string and
  privacy manifest present, and no `server` key in the Capacitor config, so it loads the bundled app
  and not a website. It is not signed, exported or validated by App Store Connect.
- **Package manifests.** The generated Homebrew cask loads in Homebrew's cask loader, and its livecheck
  picks only a release that lists the universal dmg. The Scoop manifest validates against Scoop's
  schema and the three winget files against the winget 1.10.0 schemas. None was installed.

## Not run

Tapping through the real iPhone by hand (its keyboard, the Settings footer in finding 4, the microphone
permission prompt), a physical Android device, Windows, Linux, iPad and landscape, a tablet, microphone
capture and speech input, spoken replies (no text-to-speech server), live talk, WebXR, macOS
notarization, the Mac App Store, and any store upload. The Snap has never been built: `snapcraft` does not run on macOS, so the first build is
the `snap-build.yml` workflow.
