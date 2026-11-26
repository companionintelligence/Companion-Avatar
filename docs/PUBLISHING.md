# Publishing Avatar Companion

Where each build goes, what is ready, and what only the owner can supply. Nothing in this repository
signs with a release key, notarizes, uploads or submits anything on its own: every step below that
does is a person running a command or a workflow with their own credentials. Checked on 2026-11-24
against `main` at `308b94d`; [DEVICE-QA.md](DEVICE-QA.md) says what was run on devices.

Store-by-store detail that predates this page stays where it is:
[apps/desktop/STORE-PREP.md](../apps/desktop/STORE-PREP.md),
[apps/mobile/STORE-PREP-IOS.md](../apps/mobile/STORE-PREP-IOS.md),
[apps/mobile/STORE-PREP-ANDROID.md](../apps/mobile/STORE-PREP-ANDROID.md) and
[store-readiness.md](store-readiness.md).

## Channels

| Channel | What ships | Built by | Ready | Missing |
| --- | --- | --- | --- | --- |
| GitHub pre-release | Windows NSIS and MSI, macOS dmg, Linux deb and rpm, Android APK, notices, `SHA256SUMS.txt` | `native-release.yml` | v0.2.0 is published (2026-11-15) | Nothing is signed for distribution: Windows unsigned, macOS ad-hoc, APK on a throwaway key unless the keystore secrets are set |
| macOS, direct | dmg, Developer ID signed, notarized, stapled | `apps/desktop/scripts/desktop-notarize.sh` | Script written, and its environment check runs (it reports what is missing and signs nothing). The build Mac's keychain holds the Developer ID Application identity | `APPLE_SIGNING_IDENTITY` set, and notary credentials: an App Store Connect API key, or an Apple ID with an app-specific password. Notarizing sends the app to Apple, so it waits for the owner |
| Mac App Store | Sandboxed `.pkg` | Not scripted | Entitlements file exists. The build Mac's keychain holds Apple Distribution and "3rd Party Mac Developer Installer" identities | A scripted `productbuild` and upload, a sandbox review, an App Store Connect record for the Mac app, and an answer to guideline 4.2 |
| iOS | App Store or TestFlight build | `apps/mobile/scripts/ios-archive.sh` | Debug build runs on the simulator and on an iPhone; the unsigned release archive builds (checked 2026-11-24) | Team ID, App Store profile, listing, privacy answers, and a version above the live 1.0 (see below) |
| Google Play | `.aab` | `apps/mobile/scripts/android-release.sh` | Release AAB and APK build, sign, pass the 16 KB check ([DEVICE-QA.md](DEVICE-QA.md)) | Upload keystore, Play App Signing, listing, data safety form, privacy policy |
| Windows, direct | NSIS `.exe` and `.msi`, Authenticode signed | `apps/desktop/scripts/desktop-build-windows.mjs`, on Windows | CI builds both unsigned | A code-signing certificate (`WINDOWS_CERTIFICATE_THUMBPRINT`); without one SmartScreen warns |
| Microsoft Store | The signed `.exe` or `.msi`, submitted as a Win32 app | Not scripted | The installers exist | Signed installer, Partner Center account. No MSIX is produced |
| Snap Store | `avatar-companion` snap, strict confinement | `snap-build.yml` | `snap/snapcraft.yaml` written and checked against the app. **Never built**: `snapcraft` does not run on macOS, so the first build is the workflow. The name `avatar-companion` was free on 2026-11-24 | `snapcraft register`, store credentials as a secret, a first build and a run on a real desktop |
| Homebrew | Cask `avatar-companion` in `companionintelligence/homebrew-tap` | `package-manifests.yml` | Cask generated and loads in Homebrew | A notarized macOS build. Until then the file is marked NOT PUBLISHABLE |
| Scoop | `avatar-companion.json` in `companionintelligence/scoop-bucket` | `package-manifests.yml` | Manifest generated, valid against Scoop's schema | A run on Windows (never installed); the unsigned installer will trip SmartScreen |
| winget | Three YAML files, a pull request to `microsoft/winget-pkgs` | `package-manifests.yml` | Files generated, valid against the winget 1.10.0 schemas | `winget validate` and a sandbox install on Windows, then the pull request |
| deb, rpm | The CI packages, downloaded from the release | `native-release.yml` | Built and inspected by CI | No apt or dnf repository hosts them |

Not prepared: Chocolatey, Flatpak and the AUR.

## Cut a release

1. Raise the version in every place that carries one. They must agree, and the release workflow fails
   when the tag disagrees with the first two:
   `apps/desktop/src-tauri/tauri.conf.json`, `apps/mobile/android/app/build.gradle` (`versionName`, and
   `versionCode`, which must go up for every build installed over an earlier one), then
   `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/package.json`, `apps/mobile/package.json` and
   `snap/snapcraft.yaml` (a test fails if the snap differs from the desktop version).
   The iOS version is separate: `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` in
   `apps/mobile/ios/App/App.xcodeproj/project.pbxproj` are 1.0 and 1 today, which is the live App Store
   version, so the next upload needs a higher number whatever the other apps say.
2. Run `pnpm test`, `pnpm lint` and the shells' tests: `pnpm --filter @ci-avatar/desktop test:native`
   and `pnpm --filter @ci-avatar/mobile test:native`.
3. Dispatch the release. It refuses a tag that exists, builds every installer from one commit and
   publishes a pre-release:

   ```bash
   gh workflow run native-release.yml --repo companionintelligence/Companion-Avatar \
     --ref main -f tag=v0.3.0 -f android_signing=auto
   ```

4. Render the package-manager files from that release's checksums. Add `-f macos_notarized=true` only
   when the macOS app really was notarized:

   ```bash
   gh workflow run package-manifests.yml --repo companionintelligence/Companion-Avatar \
     --ref main -f tag=v0.3.0
   ```

   The files are in the run's `package-manifests-v0.3.0` artifact. To render them without GitHub:
   `node scripts/package-manifests.mjs --tag v0.3.0 --sums SHA256SUMS.txt --out manifests`.
5. Build the snap, and publish only after a person has tried the artifact:

   ```bash
   gh workflow run snap-build.yml --repo companionintelligence/Companion-Avatar --ref main
   ```

## Each channel

### macOS

`pnpm --filter @ci-avatar/desktop build` produces `Avatar Companion.app` and the dmg under
`apps/desktop/src-tauri/target/release/bundle/` (Rust 1.95 or later: see the README). Add
`--target universal-apple-darwin` for the build that runs on Apple silicon and Intel, as CI does. Then
`apps/desktop/scripts/desktop-notarize.sh "<path to the .app>"` signs, notarizes and staples it. Run
it with `--check` first. It never uploads to a store and never prints a credential.

The Mac App Store is a different build (sandboxed, signed with the Apple Distribution identity,
packaged with `productbuild` into a `.pkg` signed by an installer identity, which the build Mac has) and
is not scripted. The Mac App Store reviews against guideline 4.2, minimum functionality, and the shell's
only native behaviour is opening links in the system browser.

### iOS

```bash
pnpm --filter @ci-avatar/web build
pnpm --filter @ci-avatar/mobile exec cap sync ios
APPLE_TEAM_ID=<10 characters> APPLE_APP_STORE_PROFILE="<profile name>" apps/mobile/scripts/ios-archive.sh
```

The script writes an `.xcarchive` and an exported `.ipa` under `apps/mobile/ios/DerivedData/`, and never
uploads. Upload with Xcode's Organizer or Transporter. Run `apps/mobile/scripts/ios-archive.sh --unsigned`
for a compile-only check that needs no team. The bundle ID `com.companionintelligence.avatar` is the
live app's and cannot change.

A store build needs `VITE_API_BASE` set to the production proxy, and that proxy must list
`capacitor://localhost` in `APP_ALLOWED_ORIGINS`, or the app cannot reach it (finding 2 in
[DEVICE-QA.md](DEVICE-QA.md)).

### Android

```bash
pnpm --filter @ci-avatar/web build
pnpm --filter @ci-avatar/mobile exec cap sync android
pnpm --filter @ci-avatar/mobile run notices
KEYSTORE_PATH=... KEYSTORE_PASSWORD=... KEY_ALIAS=... KEY_PASSWORD=... apps/mobile/scripts/android-release.sh
```

That builds `app-release.aab`, which is what Google Play takes (the APK exceeds Play's APK size cap), and
`app-release.apk`, then checks 16 KB page alignment. Without the four variables the outputs are
unsigned and Play rejects them. Start on the internal testing track and read the pre-launch report.
The upload key stays outside the repository; enrol the app in Play App Signing so Google holds the
signing key.

### Windows

CI builds the unsigned installers. To sign, run
`node apps/desktop/scripts/desktop-build-windows.mjs` on a Windows machine with the certificate
installed and `WINDOWS_CERTIFICATE_THUMBPRINT` set. The Microsoft Store accepts the signed `.exe` or
`.msi` as a Win32 app, so no MSIX is needed; that route has not been tried.

### Snap

1. `snapcraft register avatar-companion` (the owner's Snap Store account).
2. Export credentials scoped to this snap and channels, and store them as the repository secret
   `SNAPCRAFT_STORE_CREDENTIALS`:
   `snapcraft export-login --snaps avatar-companion --channels edge,beta --acls package_access,package_push,package_release credentials.txt`.
3. Run `snap-build.yml` with `publish` left at `none`, download the `avatar-companion-snap` artifact,
   and try it on a desktop: `sudo snap install --dangerous ./avatar-companion_*.snap`, then
   `snap connect avatar-companion:audio-record` for the microphone.
4. Run it again with `-f publish=edge`. Add required reviewers to the `snap-store` environment in the
   repository settings if the upload should wait for a person.
5. Change `grade: devel` to `grade: stable` in `snap/snapcraft.yaml` before releasing to candidate or
   stable: the store refuses a `devel` snap there.

The snap builds from source inside snapcraft's build environment, which needs network access, so a
Launchpad remote build cannot produce it. It targets `amd64`; adding `arm64` needs an arm64 runner.

### Homebrew, Scoop and winget

Copy the generated files into place, review them, and open a pull request in each repository:

| File | Goes to |
| --- | --- |
| `homebrew/Casks/avatar-companion.rb` | `Casks/` in `companionintelligence/homebrew-tap`. Not before the macOS app is notarized. |
| `scoop/avatar-companion.json` | The root of `companionintelligence/scoop-bucket`, beside the other manifests. |
| `winget/CompanionIntelligence.AvatarCompanion*.yaml` | `manifests/c/CompanionIntelligence/AvatarCompanion/<version>/` in a fork of `microsoft/winget-pkgs`. |

On Windows, check the winget files with `winget validate --manifest <folder>` and install them
locally from the folder before the pull request. Scoop installs the manifest with
`scoop install .\avatar-companion.json`. Both use the NSIS installer, which installs for the current
user, and neither has been run.

## Owner decisions

- **Bundle identifier.** The desktop app's `computer.ci.avatar` is provisional. Changing it later moves
  the app's data folder, so decide before any signed or store build.
- **Licence.** The repository is PolyForm Noncommercial 1.0.0. Whether a free store listing is allowed
  under it is a counsel question, and it applies to every channel above.
- **Notarization credentials.** An App Store Connect API key is preferred to an Apple ID password.
- **`capacitor://localhost`.** Should the proxy allow the iOS app's origin by default, as it does
  Android's and the desktop's? Today its tests require the refusal.
- **iOS version.** Which number follows the live 1.0.
- **Updates.** Direct downloads have no updater; Tauri's needs a signing key the owner generates.
- **Privacy policy.** A URL and the store privacy answers for microphone use and for chat text sent to
  the proxy.
- **Snap confinement.** Strict, as written, needs the microphone connected by hand until the store grants
  auto-connection for `audio-record`.
