# Avatar Companion mobile apps

Capacitor 8 shells around the web app that `apps/web` builds: an Android project in `android/` and an
iOS project in `ios/`. `cap sync` copies the web build (`../web/dist`) into each project, so the apps
run from their own origin and never load the website; `capacitor.config.ts` has no `server.url`, and
`tests/native-config.test.mjs` fails if one is added.

The app ID `com.companionintelligence.avatar` is final: it is the bundle ID of the live App Store app,
and the Android applicationId matches it.

## Android

### Build

```bash
pnpm install                                     # from the repo root
pnpm --filter @ci-avatar/web build               # the bundle the app carries
pnpm --filter @ci-avatar/mobile exec cap sync android
pnpm --filter @ci-avatar/mobile run notices      # THIRD-PARTY-NOTICES.txt and LICENSE.txt into the APK
cd apps/mobile/android
./gradlew assembleRelease                        # app/build/outputs/apk/release/
```

`run notices` writes `android/app/src/main/assets/licenses/` (ignored by git) with
`scripts/third-party-notices.mjs`: the web app's npm packages, every bundled avatar, animation and prop,
Capacitor's runtime and the Maven libraries Gradle resolves for the release build. It runs Gradle, so
sync first.

The release build is not debuggable and does not allow Android backup (`allowBackup="false"`: the
WebView's storage holds the user's settings and chosen server). On Android 12 and later a
device-to-device transfer can still copy the app's data; `dataExtractionRules` would stop that too.

### Signing

`app/build.gradle` signs the release build only when all four of these are set, from the environment
or from `android/keystore.properties` (ignored by git; see `keystore.properties.example`):

| Environment | keystore.properties | |
| --- | --- | --- |
| `KEYSTORE_PATH` | `storeFile` | the keystore file |
| `KEYSTORE_PASSWORD` | `storePassword` | its password |
| `KEY_ALIAS` | `keyAlias` | the key's alias |
| `KEY_PASSWORD` | `keyPassword` | the key's password |

With some but not all of them set, Gradle warns and the build stays unsigned. Keystores never go in the
repository.

### Versions

`versionName` in `app/build.gradle` is the app version (0.2.0, the same as the desktop app) and the
release workflow checks the tag against it. Raise `versionCode` (2 for v0.2.0) for every build that will
be installed over an earlier one: Android refuses a lower or equal one.

### Releases

`.github/workflows/native-release.yml` builds a release APK from the same web build as the desktop
installers and attaches it to the GitHub pre-release. Its `android_signing` input picks the key:

- `keystore`: the release key, from the repository secrets `AVATAR_KEYSTORE_BASE64` (the keystore,
  base64), `AVATAR_KEYSTORE_PASSWORD`, `AVATAR_KEY_ALIAS` and `AVATAR_KEY_PASSWORD`. The job decodes the
  keystore into the runner's temp folder and passes the four values to Gradle as the variables above.
- `throwaway`: a key made in the job with `keytool` and deleted afterwards.
- `auto` (the default): `keystore` when all four secrets are set, else `throwaway`.
- `skip`: no APK.

The file name says which key signed it: `avatar-companion-<tag>-android-keystore-signed.apk` or
`…-throwaway-signed.apk`. Android installs an update only over an app signed with the same key, so a
build signed with a different key needs the installed app uninstalled first, and that deletes its data.
The release notes give the signing certificate's SHA-256.

People install the APK by sideloading: open it on the phone and allow the browser or file manager to
install unknown apps. Android 7.0 (API 24) or later.

### Servers

The page's origin is `https://localhost`. The app starts in demo mode (the avatar and scripted text
chat). For a language model, open Settings, pick **Proxy** with your BFF's `https://` chat URL or
**Ollama** with an `https://` address, and press **Check connection**. The WebView reaches HTTPS
servers only: cleartext traffic is off and the page is HTTPS. The BFF in `apps/proxy` allows
`https://localhost` by default, and so does Ollama.

Store preparation (Play listing, data safety, upload key and Play App Signing) is in
`STORE-PREP-ANDROID.md`. Nothing here uploads to Google Play.

## iOS

The iOS project builds in Xcode on a Mac; it is not part of the release workflow. The commands for the
simulator and for a paired iPhone are in the root README ([iOS](../../README.md#ios)), and
`scripts/ios-archive.sh` makes the App Store archive. Signing, App Store Connect and review are in
`STORE-PREP-IOS.md`; where each build ships is in [docs/PUBLISHING.md](../../docs/PUBLISHING.md).

The iOS app's origin is `capacitor://localhost`, which the BFF does not allow by default: add it to
`APP_ALLOWED_ORIGINS`. Without it **Check connection** fails with "Load failed"
([docs/DEVICE-QA.md](../../docs/DEVICE-QA.md)). Reaching a server from the simulator or a phone also needs HTTPS: see
[Test with a backend](../../README.md#test-with-a-backend).

## Tests

```bash
pnpm --filter @ci-avatar/mobile test:native
```
