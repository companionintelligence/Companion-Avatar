#!/usr/bin/env bash
#
# Sign, notarize and staple Avatar Companion for direct (Developer ID) distribution on macOS.
#
# The Mac App Store is a different path (a sandboxed build, a .pkg from productbuild and an App
# Store Connect upload). See apps/desktop/STORE-PREP.md. This script never uploads anything
# to a store, and it never creates certificates or keys.
#
# Usage:
#   apps/desktop/scripts/desktop-notarize.sh [--check] [path/to/Avatar Companion.app]
#
#   --check   Validate the environment and tools, then exit without signing or contacting Apple.
#
# Environment. Values are never printed; only the names of missing variables are.
#   APPLE_SIGNING_IDENTITY   Developer ID Application identity, for example
#                            "Developer ID Application: Name (TEAMID)". It must be in the keychain.
#   Notary credentials, one of:
#     APPLE_API_KEY, APPLE_API_ISSUER, APPLE_API_KEY_PATH   App Store Connect API key (preferred:
#                                                            no secret goes on the command line)
#     APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID               Apple ID with an app-specific password
#
# Exit codes: 0 done, 1 signing, notarization or stapling failed, 2 not configured or wrong host.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENTITLEMENTS="$DESKTOP_DIR/src-tauri/Entitlements.plist"
DEFAULT_APP="$DESKTOP_DIR/src-tauri/target/release/bundle/macos/Avatar Companion.app"

die() {
  echo "desktop-notarize: $1" >&2
  exit "${2:-1}"
}

CHECK_ONLY=0
if [ "${1:-}" = "--check" ]; then
  CHECK_ONLY=1
  shift
fi
APP="${1:-$DEFAULT_APP}"

[ "$(uname -s)" = "Darwin" ] || die "macOS only: codesign, notarytool and stapler are not available on $(uname -s)." 2
for tool in codesign ditto spctl; do
  command -v "$tool" >/dev/null 2>&1 || die "missing tool: $tool (install the Xcode command line tools)." 2
done
xcrun --find notarytool >/dev/null 2>&1 || die "xcrun cannot find notarytool (needs Xcode 13 or later)." 2
xcrun --find stapler >/dev/null 2>&1 || die "xcrun cannot find stapler (needs Xcode 13 or later)." 2

# Collect every missing setting first, so one run reports all of them.
missing_identity=0
missing_notary=0
if [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
  missing_identity=1
fi
NOTARY=""
if [ -n "${APPLE_API_KEY:-}" ] && [ -n "${APPLE_API_ISSUER:-}" ] && [ -n "${APPLE_API_KEY_PATH:-}" ]; then
  NOTARY="api-key"
elif [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
  NOTARY="apple-id"
else
  missing_notary=1
fi

if [ "$missing_identity" -eq 1 ] || [ "$missing_notary" -eq 1 ]; then
  echo "desktop-notarize: not configured, so nothing was signed or sent to Apple." >&2
  if [ "$missing_identity" -eq 1 ]; then
    echo "  missing: APPLE_SIGNING_IDENTITY (Developer ID Application identity)" >&2
  fi
  if [ "$missing_notary" -eq 1 ]; then
    echo "  missing: notary credentials. Set APPLE_API_KEY, APPLE_API_ISSUER and APPLE_API_KEY_PATH," >&2
    echo "           or APPLE_ID, APPLE_PASSWORD and APPLE_TEAM_ID." >&2
  fi
  echo "  Owner decisions are listed in apps/desktop/STORE-PREP.md." >&2
  exit 2
fi

# Check that the identity is present and valid in the keychain. The listing holds no secrets.
IDENTITIES="$(security find-identity -v -p codesigning 2>/dev/null || true)"
case "$IDENTITIES" in
  *"$APPLE_SIGNING_IDENTITY"*) ;;
  *) die "APPLE_SIGNING_IDENTITY is not a valid code-signing identity in this keychain (security find-identity -v -p codesigning)." 2 ;;
esac

if [ "$CHECK_ONLY" -eq 1 ]; then
  echo "desktop-notarize: environment OK (signing identity present, notary mode: $NOTARY). Nothing was signed."
  exit 0
fi

[ -d "$APP" ] || die "app bundle not found: $APP. Build it first with: pnpm exec tauri build --bundles app" 2
[ -f "$ENTITLEMENTS" ] || die "entitlements file not found: $ENTITLEMENTS" 2

echo "Signing: $APP"
codesign --force --options runtime --timestamp --entitlements "$ENTITLEMENTS" --sign "$APPLE_SIGNING_IDENTITY" "$APP"
codesign --verify --strict --verbose=2 "$APP"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
ZIP="$WORK_DIR/$(basename "$APP" .app).zip"
ditto -c -k --keepParent "$APP" "$ZIP"

if [ "$NOTARY" = "api-key" ]; then
  AUTH=(--key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER")
else
  AUTH=(--apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID")
fi

# The JSON result is kept next to the bundle so a rejection can be inspected afterwards.
RESULT="$(dirname "$APP")/notarytool-result.json"
echo "Submitting to Apple notary service (waits for the verdict)..."
if ! xcrun notarytool submit "$ZIP" "${AUTH[@]}" --wait --output-format json > "$RESULT"; then
  die "notarytool submit failed. Result: $RESULT" 1
fi
if ! grep -Eq '"status" *: *"Accepted"' "$RESULT"; then
  die "notarization was not accepted. Result: $RESULT (fetch the log with xcrun notarytool log <id>)" 1
fi

xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
spctl --assess --type execute --verbose=4 "$APP"
echo "desktop-notarize: done. Signed, notarized and stapled: $APP"
