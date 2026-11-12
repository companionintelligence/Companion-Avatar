# Store readiness: Avatar Companion shells

Status on 2026-11-02, branch `feat/native-shells-face-to-voice`. The work is committed on this
branch, but nothing is signed, notarised or uploaded.

Per-platform detail: [apps/mobile/STORE-PREP-IOS.md](../apps/mobile/STORE-PREP-IOS.md),
[apps/mobile/STORE-PREP-ANDROID.md](../apps/mobile/STORE-PREP-ANDROID.md),
[apps/desktop/STORE-PREP.md](../apps/desktop/STORE-PREP.md).

## Build and test status

| Check | Result |
|---|---|
| `pnpm --filter @ci-avatar/web build` (placeholder `VITE_API_BASE`) | passes |
| Vitest after the review fixes: core-node 264, core-dom 68, web-node 259; proxy 310 from an earlier run, unchanged | all pass |
| Typecheck `packages/core` and `apps/web` | core: 59 errors, the same count as before, none in changed files; web: clean |
| iOS Debug build, iPhone 17 Pro simulator | passes and runs; rebuilt after the review fixes |
| iOS unsigned Release archive | passes; rebuilt after the review fixes |
| Android debug APK (186 MB) | builds; ran on an API 36 emulator before the review fixes |
| Android unsigned release AAB (181 MB) | builds; rebuilt after the review fixes; 16 KB alignment check passes |
| Desktop Tauri debug bundle | built before the review fixes; web layout checked in the browser pane; window not captured because the Mac was locked |

## Changes

- Body font now resolves to the sans-serif token. On iOS, text fell back to the browser serif.
- `viewport-fit=cover`, with `env(safe-area-inset-*)` on the Controls toggle, the control bar, the
  chat input and the talk button. The Controls toggle now sits above the iPhone home indicator.
- The WebXR emulator no longer starts inside a native shell. It started on any `localhost` origin,
  and the Tauri and Capacitor shells all load from localhost. It rewrote the user agent in the
  desktop app. New helper: `packages/core/src/config/nativeShell.ts`.
- Enable Mic now calls `getUserMedia` from the tap. A declined prompt opens the app with the
  microphone off, on text chat.
- Talk lip-sync falls back to `talkAnalyser()` while a live reply plays. Not yet checked against a
  live agent.

## Verification gaps

- **Microphone prompt on iOS is unverified.** On the simulator, the tap moved the app into listening
  with no system prompt, and no permission record was written afterwards. A real iPhone is needed to
  confirm the prompt appears on the first tap.
- **Android (API 36 emulator)**: the Enable Mic tap raised the system dialog "Allow Avatar Companion to
  record audio?". After "While using the app", onboarding closed and listening started. One emulator image
  was tested, so physical devices and other API levels are not covered.
- **Desktop UI** was checked in the browser pane at 1280 and 1100 px. The pill is hidden while the control bar is
  open, and when the bar is collapsed the pill sits clear of the toggle. The Tauri window itself has not been seen,
  because the Mac was at the lock screen.
- **Talk** has not been run against a live LiveKit room or agent.
- **Windows and Linux** have no build host. The Windows and Linux config only passes the Tauri schema
  check.

## Layout

1. Resolved. Phones start with the Controls panel collapsed. The "Tap to listen" pill sits beside the Controls
   toggle, clear of the home indicator. Opening the control bar hides the pill at every width, because the bar
   covers that corner. On desktop the bar starts open, so the pill starts hidden and appears when the bar is
   collapsed. Checked on the iPhone 17 Pro simulator, and in the browser pane at 1280 and 1100 px.
2. Resolved. The logo badge, the chat sheet and the top-right chevron start below the top safe-area inset, so
   the Dynamic Island no longer covers them. Checked on the iPhone 17 Pro simulator and on the Android API 36
   emulator.
3. Still open: when the keyboard opens on iOS, the avatar canvas shifts up under the status bar and clips the
   head.
4. Listening state: the caption now sits above the pill, the waveform is off on phones, and the pill caps its
   width so the Stop button stays on screen. This is checked in code and by geometry only. On the iPhone
   simulator, tapping the pill did not start listening, so the layout could not be seen in that state.
5. Talk button (only when `VITE_TALK_ENABLED` is true): it collides with the top-right chevron, and it sits under
   the desktop chat rail while the rail is open. Both predate this change. Choose a placement before a build
   enables talk.
6. XR layout: not checked.
7. Landscape with the Dynamic Island on the left: the pill now takes the left inset. Not run on a device.

## Review of the layout change

An adversarial review ran four lenses (safe area, phone behaviour, desktop and XR regressions, tests). A skeptic
checked each finding against the code. Of 21 findings, 12 were confirmed and fixed in this pass, 7 are open, and
2 were refuted.

Fixed: the caption overlap, the pill overflowing narrow phones, the pill covered by the open desktop bar, the
landscape left inset, the collapsed panel staying in the tab order, the one-frame flash on phones, two storyboard
"Hide Controls" steps that no longer have a target, a stale microphone check, and a test for the bottom-left inset.

Open: four talk-button collisions (they predate this change), and three missing tests (the pill rule, the logo
offset and the controlled panel). The Android viewport-fit recheck on WebView 140 or later is still outstanding,
although the skeptic refuted it as a defect.

## Owner decisions and blockers

- **Avatar redistribution.** `assets/avatars/vrm/NOTICE.md` restricts redistribution for 9 of the 10
  VRMs: seven say "Redistribution prohibited" and two say "author only". Only yuki allows it, and
  not for commercial use. A store build needs licences or a slimmer avatar set. The slim set is not
  built yet.
- **Licence.** The repo is PolyForm Noncommercial 1.0.0. Whether a free store listing is allowed is a
  counsel decision.
- **Identifiers.** `com.companionintelligence.avatar` is the iOS bundle ID of the live App Store app, and the Android applicationId matches it. The Android applicationId becomes permanent
  after the first upload.
- **Signing.** iOS needs the Apple team ID, a distribution certificate and a profile. Android needs an
  upload keystore and Play App Signing enrolment. Desktop needs Developer ID signing and notarisation,
  which has not been run because it uploads to Apple.
- **Backend.** The bundles carry `VITE_API_BASE=https://bff.example.invalid`. Set it to the production
  BFF origin, and allow these origins in `APP_ALLOWED_ORIGINS`: `capacitor://localhost` (iOS),
  `https://localhost` (Android), `tauri://localhost` and `http://tauri.localhost` (desktop).
- **Review access.** Demo mode exists (the "Demo-only" session). Decide whether the review notes rely
  on it, as the guideline 4.2 argument.
- **Listing and policy.** Privacy policy and support URLs, and listing copy. The "fully local" claim
  conflicts with the browser speech default, so confirm it before submitting.
- **AI disclosures.** iOS guideline 5.1.2(i) needs a data-sharing disclosure. For Play's
  generative-AI reporting, confirm the current policy text, since the page checked did not state an
  in-app flag duty.
- **Android backup.** `allowBackup` is true, so web storage is backed up. Set it false or add
  data-extraction rules.
- **Size.** The iOS app is 257 MiB, of which the VRMs are 141.6 MB. The Play AAB is 181 MB, under the
  200 MB cellular warning.
- **Usage strings.** iOS needs an `AudioData` declaration if `VITE_STT_REMOTE=true`. It is off in this
  build.
- **Hugging Face download.** The iOS track listed a Hugging Face model download as a blocker. I have
  not confirmed what it fetches or whether the store build includes it.
- **Desktop scope.** The Mac App Store path, MSIX packaging and store acceptance are not verified. WebXR
  is not available in the WKWebView or WebView2 wrappers.
