# Android store prep: Avatar Companion

Checked 2026-11-02 on branch `feat/native-shells-face-to-voice` in the native-shells worktree. Nothing was uploaded or submitted. No Play Console account, upload key or certificate was created. Signing was tested with a throwaway keystore in the scratchpad, which was deleted afterwards.

Identifiers and levels: applicationId and namespace `computer.ci.avatar` (provisional, see below), app name "Avatar Companion", versionCode 1, versionName 1.0, minSdk 24, compileSdk 36, targetSdk 36.

## Ready

- **Sync.** `pnpm exec cap sync android` (apps/mobile) exits 0 on Capacitor 8.6.0. The web bundle is the lead's `apps/web/dist` snapshot.
- **Debug build.** `./gradlew assembleDebug` succeeds. `app-debug.apk` is 185,693,291 bytes.
- **Runs on the API 36.1 image.** Tested on an arm64 Google Play emulator with WebView 134.0.6998.135. The splash is the brand navy with light status-bar icons. The status and gesture bars are navy with light icons. The web content starts below the status bar. The avatar renders.
- **Launcher icon.** Adaptive icon with a white background and the CI mark inside the 66 dp safe circle. Legacy square and round icons cover API 24 and 25. `apps/mobile/scripts/android-icons.sh` generates them from `CI-Common/assets/logos/app-icon-source.png`. The icon shows correctly on the emulator home screen.
- **Play icon.** 512 x 512 PNG, 47,660 bytes, kept in the scratchpad rather than the repo. The brief asked for "no alpha". Play's icon spec says "32-bit PNG" and recommends no transparency. The file is 8-bit RGBA with every alpha value at 255, so it meets both.
- **Target API.** The Play Console help page (checked 2026-11-02) says new apps and app updates must target Android 16 (API 36) or higher, with a deadline of 31 August 2026. targetSdkVersion is 36, which meets it. The page names no higher level.
- **Release signing.** `signingConfigs.release` reads `android/keystore.properties`, or the environment variables `KEYSTORE_PATH`, `KEYSTORE_PASSWORD`, `KEY_ALIAS` and `KEY_PASSWORD`. With neither set, the build is unsigned. Tested with a throwaway keystore: the bundle and the APK were signed with that certificate, and `apksigner verify` passed with the v2 scheme.
- **Release bundle.** `./gradlew bundleRelease` without a keystore gives `app/build/outputs/bundle/release/app-release.aab`, 181,136,133 bytes. jarsigner reports it as unsigned, as expected. `apps/mobile/scripts/android-release.sh` builds the bundle and the APK and runs the alignment check.
- **16 KB pages.** `zipalign -c -P 16 4` (build-tools 36.1.0) exits 0 on the release APK and on the debug APK. Neither APK contains a native `.so` file.
- **Permissions.** The merged manifest declares INTERNET, RECORD_AUDIO and MODIFY_AUDIO_SETTINGS. RECORD_AUDIO is needed for the talk control. MODIFY_AUDIO_SETTINGS is needed because Capacitor's WebView permission handler asks for it together with RECORD_AUDIO and denies the whole request when it is missing. The microphone is declared as an optional hardware feature, since text chat works without it.
- **Build flags.** The release build is not debuggable. Cleartext traffic is off at targetSdk 36. The WebView DevTools socket appears only in debuggable builds, which the emulator run confirmed.
- **Git hygiene.** `keystore.properties`, `*.jks` and `*.keystore` are ignored, checked with `git check-ignore`. `android/keystore.properties.example` is committed.

## The owner must supply

1. **applicationId.** `computer.ci.avatar` is provisional. An Android applicationId is permanent once uploaded. Choose the final ID before any upload. If it changes, update `capacitor.config.ts` (appId), `android/app/build.gradle` (namespace and applicationId) and the Java package directory under `src/main/java` together.
2. **Upload key and Play App Signing.** Create the upload keystore on the owner's machine, outside the repo, and back it up. Fill in `android/keystore.properties` from the example, or set the four environment variables. Enrol the app in Play App Signing, so that Google holds the app signing key and the upload key only signs uploads.
3. **Play Console listing.** App name (check availability). Short description, 80 characters at most. Full description, 4,000 characters at most. 512 x 512 icon (in the scratchpad). 1024 x 500 feature graphic (not made). Phone screenshots from a release-like build, 2 to 8 images under Play's current rules. The emulator captures are for internal checks only. Tablet screenshots if the listing targets tablets.
4. **Data safety form.**
   - Audio: the microphone is read on the device when the talk control is on. The iOS build has remote speech-to-text off (`stt.remote` is false in the bundle), and the Android build uses the same bundle. Confirm that before answering. If audio is sent to the BFF, declare it as collected and shared.
   - Chat text: sent to the owner's BFF (`/api/chat`), which can forward it to LLM providers. Declare it as collected, shared with service providers and encrypted in transit. The text-to-speech input (`/api/tts`) is text.
   - No ads, analytics or crash SDK is in the Gradle dependencies. The web bundle has no Sentry or Firebase code. These are string checks, not a dependency audit.
   - No in-app deletion exists yet. Declare the owner's retention policy.
5. **Content rating (IARC questionnaire).** AI chat with generated text and a 3D avatar. The bundle names `ollama.com/api/web_search` and `/api/web_fetch`. If those tools are reachable in the store build, answer the unrestricted web access question accordingly.
6. **Target audience.** Choose an audience that excludes children, unless child-directed use is intended. Do not join the Families programme.
7. **Ads declaration.** "Contains ads: no", based on the checks above. Recheck before each release.
8. **Privacy policy URL.** The owner or counsel supplies it. It must name the BFF, the LLM providers, the microphone use and the chat data.
9. **Account deletion.** Not triggered by the current code. No sign-in code was found in `apps/web/src` or `packages/core/src`. Revisit if CI-Hub sign-in is added.
10. **App access for reviewers.** Demo path: launch, the "Start your companion" sheet, "Check connection" (reports Demo-only), Skip, then type a message. The avatar answers from the local demo responder. The Android run did not go through this path. Live path: the store build needs a production `VITE_API_BASE`, and the proxy's `APP_ALLOWED_ORIGINS` must include `https://localhost`. That is the Android origin. The iOS origin is `capacitor://localhost`.
11. **Generative-AI reporting.** The task cites the mobile assessment for an in-app reporting requirement. That assessment is not in this checkout, and it was not found in the top four levels of CI-Engineering. Play's AI-Generated Content policy page (fetched 2026-11-02) asks developers to stop offensive output from generative AI apps. The text I could read does not state an in-app report or flag duty. A press report of a 2023 Play policy update says generative AI apps must let users flag objectionable output in the app. Owner or counsel: check the current Play Developer Program Policy text. If a flag control is required, add one to AI replies. It is not built.
12. **Rights and licence blockers.** The same as iOS. See the Blockers section of `apps/mobile/STORE-PREP-IOS.md`. Avatar redistribution: 9 of the 10 VRMs restrict it. GLB licences need review, and `LiamCES.glb` and `LiamCES2.glb` name a person, so consent is needed. PolyForm Noncommercial sits uneasily with a free public listing. The bundle has the placeholder origin `https://bff.example.invalid`. The on-device model downloads weights from huggingface.co.
13. **Size.** The unsigned bundle is 181.1 MB, about 19 MB under the 200 MB cellular warning in Play's documentation. That threshold applies to the compressed download, which this figure approximates. Play's limits are a 500 MB base module, a 4 GB cumulative total for install-time content, and a 100 MB cap on APK uploads, so upload the AAB. The VRMs are 141.6 MB decimal (per the iOS note). Removing the restricted avatars would take the bundle well under the warning.
14. **Track.** Start with internal testing and the pre-launch report. The owner approves each upload. Bump versionCode on every upload.

## Blockers (owner or counsel)

Items 11 and 12 above, plus the size choice in item 13. No native change resolves them.

## Web-side changes for the lead

1. `https://localhost/config.json` is requested on every launch and is not in `apps/web/dist`. The WebView logs "Unable to open asset URL". Add the file, or make the fetch fall back quietly.
2. API base. The Android shell loads `https://localhost`. Store builds need the production BFF origin in `VITE_API_BASE`, and the proxy's `APP_ALLOWED_ORIGINS` must include `https://localhost`.
3. The bundle still has the placeholder origin `https://bff.example.invalid` (per the iOS note; the same bundle file is used here).
4. Console noise from the avatar clips: `THREE.PropertyBinding: No target node found for track` for hand and eye end bones, and `[avatar] emote targets with no canonical mapping: happy, angry, sad, surprised, relaxed, neutral, blink`.
5. A single tap on "Enable Mic" on the emulator did not raise a permission prompt. The native permission path was checked directly through the WebView with `getUserMedia`. Check the talk control's flow.
6. "No available adapters" appears three times at load. The source was not identified.
7. Insets: no change is needed on Android now, because `index.html` has no `viewport-fit=cover` and SystemBars pads the WebView. If the lead adds `viewport-fit=cover` for iOS, recheck Android. From WebView 140 the system stops padding a page that has it, and the page must use `env(safe-area-inset-*)` instead.
8. Status-bar icons are light through native code in `MainActivity`. The same result comes from `plugins.SystemBars.style: 'DARK'` in `capacitor.config.ts`. Either works, and the native code keeps working if the config changes.

## Native follow-ups

- `android:allowBackup="true"` lets Android back up app data, including web storage, to Google's backup service. Decide whether conversation data should be backed up. Then set `allowBackup="false"`, or add data-extraction rules.

## Not verified

- Physical devices. Testing used one API 36.1 arm64 emulator with WebView 134. Not tested: API 24 to 35, other ABIs, tablets, foldables, and WebView 140 or later with `viewport-fit`.
- Microphone capture. The WebView permission path was checked: the prompt appears on a revoked install, the grant reaches the page, and `getUserMedia` returns granted. The emulator has no audio device, so live capture and the talk flow are not verified.
- Backend behaviour. No backend was reachable, and the demo path was not run on Android.
- Play Console behaviour: upload, Play App Signing, pre-launch report and listing validation. No account was used.
- Performance on real hardware. The emulator ran under heavy host load.
- Legacy icons on API 24 and 25. They were generated and checked for size and transparency, not on a device.
- The task's `monkey -p computer.ci.avatar -c android.intent.category.LAUNCHER 1` did not bring the app forward on this emulator. It injected a single touch. `am start -n computer.ci.avatar/.MainActivity` launches it.

## Commands

- `pnpm exec cap sync android` in apps/mobile: exit 0.
- `./gradlew assembleDebug` in android/: exit 0.
- `apps/mobile/scripts/android-icons.sh [play-icon-out.png]`: regenerates the launcher icons, and the Play icon when given a path. Needs ImageMagick.
- `apps/mobile/scripts/android-release.sh`: builds the release bundle and APK, then runs `zipalign -c -P 16 4`. Signs only when keystore settings are present. It never uploads and never creates a keystore.

Evidence was kept locally and is not in the repo. Relevant files: `android-cap-sync.log`, `gradle-assembleDebug-final.log`, `gradle-release-signed.log`, `verify-signed-and-align.log`, `android-release-final.log`, `jarsigner-final.log`, `android-splash-6.png` (splash), `android-launch-7.png` (main screen), `android-home-icons.png` (launcher icon), and the `android-cdp` folder (microphone checks).
