#!/usr/bin/env bash
# Archive the Avatar Companion iOS app (Release) for App Store Connect.
#
# Signed archive and export:
#   APPLE_TEAM_ID=<10-character team ID> [APPLE_APP_STORE_PROFILE=<profile name>] \
#     apps/mobile/scripts/ios-archive.sh
#
# Writes ios/DerivedData/archives/AvatarCompanion-<stamp>.xcarchive and an exported .ipa under
# ios/DerivedData/export-<stamp>/. Both live under the gitignored DerivedData folder. Nothing is
# uploaded here. Upload is a separate, owner-approved step.
#
# Compile-only archive, no team and no signing, no export:
#   apps/mobile/scripts/ios-archive.sh --unsigned
#
# Run `pnpm exec cap sync ios` first, so ios/App/App/public holds the web build. This script never
# builds apps/web.
set -euo pipefail

MODE="signed"
if [[ "${1:-}" == "--unsigned" ]]; then
  MODE="unsigned"
  shift
fi
if [[ $# -gt 0 ]]; then
  echo "ios-archive: unexpected argument: $1" >&2
  echo "usage: ios-archive.sh [--unsigned]   (signed mode needs APPLE_TEAM_ID)" >&2
  exit 2
fi

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_DIR="$MOBILE_DIR/ios"
PROJECT="$IOS_DIR/App/App.xcodeproj"
SCHEME="App"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="$IOS_DIR/DerivedData"
ARCHIVE_DIR="$OUT_DIR/archives"
PROFILE_PLACEHOLDER="REPLACE_WITH_APP_STORE_PROFILE_NAME"
TEAM_PLACEHOLDER="REPLACE_WITH_APPLE_TEAM_ID"

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "ios-archive: xcodebuild not found. Install Xcode and run xcode-select first." >&2
  exit 2
fi

if [[ ! -f "$IOS_DIR/App/App/public/index.html" ]]; then
  echo "ios-archive: web bundle missing at ios/App/App/public. Run 'pnpm exec cap sync ios' from apps/mobile." >&2
  exit 2
fi

if [[ "$MODE" == "signed" ]]; then
  if [[ -z "${APPLE_TEAM_ID:-}" ]]; then
    echo "ios-archive: APPLE_TEAM_ID is required for a signed archive: the 10-character Apple Developer team ID." >&2
    echo "ios-archive: set it, for example APPLE_TEAM_ID=ABCDE12345 apps/mobile/scripts/ios-archive.sh" >&2
    echo "ios-archive: or pass --unsigned for a compile-only archive that needs no team." >&2
    exit 2
  fi
  if [[ ! "$APPLE_TEAM_ID" =~ ^[A-Z0-9]{10}$ ]]; then
    echo "ios-archive: APPLE_TEAM_ID must be 10 characters, A-Z and 0-9 only." >&2
    exit 2
  fi
  # Check the export profile before archiving, so a missing profile does not waste a signed build.
  if [[ -z "${APPLE_APP_STORE_PROFILE:-}" ]] && grep -q "$PROFILE_PLACEHOLDER" "$IOS_DIR/ExportOptions.plist"; then
    echo "ios-archive: no App Store distribution profile for computer.ci.avatar is set." >&2
    echo "ios-archive: set APPLE_APP_STORE_PROFILE=<profile name>, or replace $PROFILE_PLACEHOLDER in ios/ExportOptions.plist, then rerun." >&2
    exit 2
  fi
fi

mkdir -p "$ARCHIVE_DIR"

if [[ "$MODE" == "unsigned" ]]; then
  ARCHIVE="$ARCHIVE_DIR/AvatarCompanion-unsigned-$STAMP.xcarchive"
  echo "ios-archive: compile-only Release archive (CODE_SIGNING_ALLOWED=NO) -> $ARCHIVE"
  xcodebuild \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -configuration Release \
    -sdk iphoneos \
    -destination "generic/platform=iOS" \
    -archivePath "$ARCHIVE" \
    CODE_SIGNING_ALLOWED=NO \
    ENABLE_USER_SCRIPT_SANDBOXING=NO \
    archive
  echo "ios-archive: unsigned archive finished: $ARCHIVE"
  exit 0
fi

ARCHIVE="$ARCHIVE_DIR/AvatarCompanion-$STAMP.xcarchive"
EXPORT_DIR="$OUT_DIR/export-$STAMP"
EXPORT_OPTIONS="$OUT_DIR/ExportOptions-$STAMP.plist"

echo "ios-archive: signed Release archive for team $APPLE_TEAM_ID -> $ARCHIVE"
xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration Release \
  -sdk iphoneos \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID" \
  CODE_SIGN_STYLE=Automatic \
  ENABLE_USER_SCRIPT_SANDBOXING=NO \
  archive

# Fill the export options from the environment, on a copy, so the tracked plist keeps its placeholders.
cp "$IOS_DIR/ExportOptions.plist" "$EXPORT_OPTIONS"
/usr/libexec/PlistBuddy -c "Set :teamID $APPLE_TEAM_ID" "$EXPORT_OPTIONS"
if [[ -n "${APPLE_APP_STORE_PROFILE:-}" ]]; then
  /usr/libexec/PlistBuddy -c "Set :provisioningProfiles:computer.ci.avatar $APPLE_APP_STORE_PROFILE" "$EXPORT_OPTIONS"
elif grep -q "$PROFILE_PLACEHOLDER" "$EXPORT_OPTIONS"; then
  echo "ios-archive: the archive is at $ARCHIVE, but export needs an App Store distribution profile for computer.ci.avatar." >&2
  echo "ios-archive: set APPLE_APP_STORE_PROFILE=<profile name> and rerun the export step, or edit ios/ExportOptions.plist." >&2
  exit 2
fi
if grep -q "$TEAM_PLACEHOLDER" "$EXPORT_OPTIONS"; then
  echo "ios-archive: teamID placeholder still present in $EXPORT_OPTIONS" >&2
  exit 2
fi

echo "ios-archive: exporting for app-store-connect -> $EXPORT_DIR"
xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$EXPORT_OPTIONS"

echo "ios-archive: export finished: $EXPORT_DIR (not uploaded)"
