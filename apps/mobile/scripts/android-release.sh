#!/usr/bin/env bash
# Builds the Android release bundle and APK, then checks the APK for 16 KB page alignment.
# Signing comes from android/keystore.properties, or from the environment variables
# KEYSTORE_PATH, KEYSTORE_PASSWORD, KEY_ALIAS and KEY_PASSWORD. Without either, the outputs
# are unsigned and Google Play will not accept them. This script never uploads anything and
# never creates a keystore.
#
#   apps/mobile/scripts/android-release.sh
set -euo pipefail

MOBILE="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID_DIR="$MOBILE/android"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ZIPALIGN="$SDK/build-tools/36.1.0/zipalign"
[ -x "$ZIPALIGN" ] || { echo "zipalign not found at $ZIPALIGN" >&2; exit 1; }

cd "$ANDROID_DIR"
./gradlew --console=plain bundleRelease assembleRelease

AAB_DIR="$ANDROID_DIR/app/build/outputs/bundle/release"
APK_DIR="$ANDROID_DIR/app/build/outputs/apk/release"
AAB="$AAB_DIR/app-release.aab"
# The newest release APK is the one just built, signed or unsigned.
APK="$(ls -t "$APK_DIR"/*.apk | head -n 1)"

"$ZIPALIGN" -c -P 16 4 "$APK"
echo "16 KB page alignment OK: $APK"

for file in "$AAB" "$APK"; do
  echo "$file $(wc -c < "$file" | tr -d ' ') bytes"
done
