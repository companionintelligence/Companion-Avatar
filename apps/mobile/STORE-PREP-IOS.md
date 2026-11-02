# iOS store prep: Avatar Companion

Checked 2026-11-02 on branch `feat/native-shells-face-to-voice` in the native-shells worktree. Nothing was signed, uploaded or submitted. No certificates, profiles or accounts were created.

The bundle ID `computer.ci.avatar` is provisional. `capacitor.config.ts` says so, and this document keeps that caveat.

## Ready

- **Sync.** `pnpm exec cap sync ios` succeeds on Capacitor 8.6.0. The project uses Swift Package Manager (`ios/App/CapApp-SPM`), so there is no Podfile and no CocoaPods step. The synced web bundle is `ios/App/App/public`, copied from the lead's `apps/web/dist` snapshot.
- **Debug build.** Builds for the iPhone 17 Pro simulator with Xcode 27.0 and the iphonesimulator 27.0 SDK. The project has no `App.xcworkspace`, so the build uses `-project ios/App/App.xcodeproj`.
- **Release archive, unsigned.** `apps/mobile/scripts/ios-archive.sh --unsigned` succeeds. The archive is arm64 only, has MinimumOSVersion 15.0, lists device families 1 and 2 (iPhone and iPad), and has CFBundleIdentifier `computer.ci.avatar`. Its `capacitor.config.json` has no `server` key, so the shell loads the bundled web app and not a remote URL.
- **Export compliance.** `ITSAppUsesNonExemptEncryption` is `false` in `App/Info.plist`.
- **Privacy manifest.** `App/PrivacyInfo.xcprivacy` is in the app target's Resources phase and inside the Release archive's `App.app`. It is provisional (see below).
- **App icon.** The stock Capacitor placeholder (a blue X on a white grid) is replaced by the CI-Common `app-icon-source.png`, flattened onto `#041620`. That colour is the brand dark background from the web manifest. The file is 1024 x 1024, RGB, no alpha.
- **Minimum iOS.** Capacitor 8.6.0 declares `s.platform = :ios, 15.0` in `@capacitor/ios`, and the generated `CapApp-SPM/Package.swift` declares `.iOS(.v15)`. The App target has `IPHONEOS_DEPLOYMENT_TARGET = 15.0` in every configuration, so the two agree.
- **Archive script.** `apps/mobile/scripts/ios-archive.sh` exits 2 before calling `xcodebuild` when `APPLE_TEAM_ID` is unset or malformed, when no export profile is set, or when an unknown argument is given. It never uploads.

## The owner must supply

1. **Bundle ID.** Register an explicit App ID for `computer.ci.avatar` in the Apple Developer portal, or choose the final identifier first. The bundle ID cannot change after the first upload. The Android `applicationId` has the same permanence.
2. **Team ID.** The 10-character Apple Developer team ID, passed as `APPLE_TEAM_ID`.
3. **Distribution certificate.** An Apple Distribution certificate, created by the owner on the signing Mac.
4. **Provisioning.** An App Store distribution profile for `computer.ci.avatar`, passed as `APPLE_APP_STORE_PROFILE` or written into `ios/ExportOptions.plist`. Automatic signing is the alternative: change `signingStyle` and remove `provisioningProfiles`.
5. **App Store Connect listing.** Name (check availability), subtitle, description, keywords, support URL, privacy policy URL and category.
6. **Age rating.** The bundle references `ollama.com/api/web_search` and `/api/web_fetch`. If those tools are reachable in the store build, answer the unrestricted web access question accordingly.
7. **App Privacy answers.** Start from the provisional manifest: Other User Content, not linked to the user, not used for tracking, purpose App Functionality. Add Audio Data only if the production build sets `VITE_STT_REMOTE=true`. Add diagnostics only if a Sentry DSN is baked in.
8. **Export compliance.** Confirm that the app uses only HTTPS and operating-system cryptography. The web bundle was not audited for custom cryptography.
9. **Screenshots.** iPhone and iPad sets. The app is universal (`TARGETED_DEVICE_FAMILY = 1,2`), so iPad screenshots are required too. Use the sizes App Store Connect asks for at submission. No store-ready screenshots exist yet. The simulator captures listed under Evidence are for debugging only.
10. **Review notes and reviewer access.** Give a demo path and a reachable live backend.
    - Demo path, verified on the iPhone 17 Pro simulator with the placeholder backend: launch, then the "Start your companion" sheet, then "Check connection" (which reports `Session: Demo-only`), then Skip, then type a message. The avatar answers from the local demo responder.
    - Live path: the store build needs a production `VITE_API_BASE`, and the proxy's `APP_ALLOWED_ORIGINS` must include `capacitor://localhost` (see `packages/core/src/config/apiBase.ts`).
11. **Guideline 4.2 (minimum functionality).** The owner has to make the argument. The honest material is: the 3D avatar renders on the device, the app has its own microphone permission text, it has a Demo-only mode that works without a server, and it has a native icon and launch screen. The shell loads its bundled web app, not a website. Do not overstate this, because reviewers will try the demo path.
12. **Guideline 5.1.2(i) (sharing data with AI services).** Chat text goes to the owner's BFF (`/api/chat`) and text-to-speech input to `/api/tts`. The BFF can forward to an LLM provider; the bundle also names `api.openai.com` and `ollama.com`. Name the providers in the privacy policy. If a third-party AI provider receives personal data, add in-app disclosure and consent.
13. **Account deletion.** Not triggered. A search of `apps/web/src` and `packages/core/src` found no sign-in code (`oidc`, `login`, `signin`, `logout`). Revisit if the store build requires CI-Hub sign-in.

## Blockers (owner or counsel decisions, not code)

- **Avatar redistribution.** `NOTICE.md` lists the terms for the 10 VRMs in `assets/avatars/vrm/`. Seven say "Redistribution prohibited": `casualman`, `sportboy`, `sportwoman`, `erik`, `maya`, `scout` and `kenji`. Two say "author only": `casualperson` and `workboy`. Only `yuki` allows redistribution, and only without commercial use. So 9 of the 10 restrict redistribution. The brief said 8, and `NOTICE.md` gives 9. `AvatarOptions.ts` lists all 10. The default avatar is `25-1-3_CI_model_male_Greg.glb`, which is not a VRM. The 11th VRM, `humgen-aria-01.vrm`, is Companion Intelligence's own and falls under the repository licence.
  - The GLB avatars have no machine-readable licence, and `NOTICE.md` asks for separate review. `LiamCES.glb` and `LiamCES2.glb` look like models of a named person (the filename contains "Liam"), so confirm consent and licence before shipping. `rpm-mixamo-t-posed.glb` and `unbranded-woman-short-hair.glb` also need review.
  - Options: remove the restricted files from the store build, or get written permission per file.
- **Licence.** The repository is PolyForm Noncommercial 1.0.0. A free App Store listing distributes the app publicly. The owner or counsel must decide whether that counts as noncommercial use.
- **Size.** `apps/web/dist` and the synced `public` folder are 257 MiB by `du -sh` (269.5 MB decimal). The VRMs are 141.6 MB decimal (about 135 MiB). The unsigned `.app` in the archive is 259 MiB. Options: move the VRMs to on-demand downloads, remove the restricted files (above), or disclose the size. Check Apple's current limits for cellular downloads of large apps.
- **Placeholder backend.** The bundle contains `https://bff.example.invalid` in `index-D7DUBsCu.js`. The store build needs the production BFF origin.
- **On-device model download.** `@mlc-ai/web-llm` fetches weights from `huggingface.co` (the bundle lists Llama-3.2 model URLs). Weights are data, not code, so this is probably acceptable under guideline 2.5.2. Confirm that the runtime and any WebAssembly come from the bundle, and disclose the download.

## Privacy manifest (provisional)

`PrivacyInfo.xcprivacy` declares:

- `NSPrivacyTracking` false and no tracking domains.
- One collected type, `NSPrivacyCollectedDataTypeOtherUserContent`, not linked and not used for tracking, with purpose App Functionality.
- No required-reason API entries.

Evidence for the empty required-reason list: `nm -u` on the App binary lists 30 undefined symbols, all from the C library, dyld, `os_log` and the dynamic loader. None is on Apple's required-reason list. `Capacitor.framework` and `Cordova.framework` both ship empty manifests.

Not declared, on purpose:

- **Audio data.** Remote speech is off in this build: the bundle contains `remote:!1`, which is the default when `VITE_STT_REMOTE` is not `'true'`. If the production build sets `VITE_STT_REMOTE=true`, add `NSPrivacyCollectedDataTypeAudioData`.
- **Diagnostics.** No Sentry code is in the bundle (zero matches across all 13 JS chunks). If a DSN is baked in, add crash and performance data.

Not confirmed: Apple revises the required-reason list, so recheck it before each submission. The manifest covers native code only. WebKit's own storage APIs, which the web code uses, are not declared by the app.

## Signing and archive commands

```
APPLE_TEAM_ID=ABCDE12345 APPLE_APP_STORE_PROFILE="Avatar Companion App Store" \
  apps/mobile/scripts/ios-archive.sh
```

The team ID and profile above are examples. The script rejects malformed team IDs.

Output goes to `ios/DerivedData/archives/AvatarCompanion-<stamp>.xcarchive` and `ios/DerivedData/export-<stamp>/`, both under the gitignored DerivedData folder. The script never uploads. Upload is a separate step that the owner approves.

Compile-only check, with no team and no signing: `apps/mobile/scripts/ios-archive.sh --unsigned`.

## Not verified

- iPad layout and iPad screenshots. The iPad simulator is shared with other work, so no iPad screenshots were taken.
- Landscape rendering of this app. A rotation test landed on another app on the shared iPhone, and the device was rotated back.
- Microphone permission and speech input. "Enable Mic" was not tapped.
- Signed archive, export and App Store validation. These need a team, certificates and profiles, which were deliberately not used.
- Any backend behaviour. Only the placeholder backend was exercised.

## Web-side changes for the lead

1. `apps/web/src/styles/index.css`, `body` rule: add `font-family: var(--font-sans);`. Without it, unstyled text falls back to the browser's default serif. This is the likely cause of the serif titles, such as "Start your companion", "Chat Log" and "Connection truth" render in a Times-like face on the simulator.
2. `apps/web/index.html` viewport meta: add `viewport-fit=cover`. Then add `padding-bottom: env(safe-area-inset-bottom)` to the bottom Controls and input dock, and `padding-top: env(safe-area-inset-top)` to the top header. Without `viewport-fit=cover`, `env()` returns 0, so the padding alone does nothing. On the iPhone 17 Pro the Controls pill sits about 20 pt above the bottom edge, inside the 34 pt home-indicator area (estimated from the screenshot). Recheck on the simulator after the change.
3. Production build: set `VITE_API_BASE` to the production BFF origin, and add `capacitor://localhost` to the proxy's `APP_ALLOWED_ORIGINS`. Decide `VITE_STT_REMOTE`.
4. Store builds: remove the restricted VRMs from `packages/core/src/components/scene/avatar/AvatarOptions.ts`, or gate them behind a build flag, once the owner has decided the licence question.
5. Low priority: when the keyboard opens, the avatar canvas shifts up under the status bar, so the head is clipped. Check the canvas sizing on keyboard show.

## Evidence

Logs were kept locally and are not in the repo:

- `ios-cap-sync.log`: exit 0.
- `ios-xcodebuild-debug-sim.log`: `BUILD SUCCEEDED`, exit 0.
- `ios-iphone17pro-install-launch.log`: install and launch exit 0, pid 77670.
- `ios-app-log-1.txt` and `ios-app-log-2.txt`: no crash. The haptic and accessibility errors look like simulator noise.
- `ios-archive-unsigned.log`: `ARCHIVE SUCCEEDED`, exit 0.
- `ios-archive-guards.log`: guard paths, exit 2 each.
- `ios-iphone17pro-launch-1.png`, `ios-iphone17pro-demo-only-check.png`, `ios-iphone17pro-main-ui.png`, `ios-iphone17pro-controls-and-input.png`, `ios-iphone17pro-keyboard-demo-reply.png`: simulator screenshots.
