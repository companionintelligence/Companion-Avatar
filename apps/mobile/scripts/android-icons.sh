#!/usr/bin/env bash
# Rebuilds the Android launcher icons (legacy square, legacy round and the adaptive
# foreground) from the brand app icon. Optionally writes the 512 px Play Store icon too.
#
#   apps/mobile/scripts/android-icons.sh [play-icon-out.png]
#
# Needs ImageMagick (magick). The source is the 1024 px transparent mark from CI-Common;
# point CI_ICON_SOURCE somewhere else to override it. The background is white, matching
# values/ic_launcher_background.xml.
set -euo pipefail

MOBILE="$(cd "$(dirname "$0")/.." && pwd)"
RES="$MOBILE/android/app/src/main/res"
SRC="${CI_ICON_SOURCE:-$HOME/devel/ci/CI-Common/assets/logos/app-icon-source.png}"
PLAY_OUT="${1:-}"

command -v magick >/dev/null || { echo "magick (ImageMagick) not found" >&2; exit 1; }
[ -f "$SRC" ] || { echo "missing icon source: $SRC" >&2; exit 1; }

# density:legacy launcher px:adaptive foreground px (108 dp at that density)
for entry in mdpi:48:108 hdpi:72:162 xhdpi:96:216 xxhdpi:144:324 xxxhdpi:192:432; do
  IFS=: read -r density legacy fg <<< "$entry"
  dir="$RES/mipmap-$density"
  mkdir -p "$dir"

  # Legacy square: the mark at 80 % on white, for devices below API 26.
  k=$(( legacy * 80 / 100 ))
  magick -size "${legacy}x${legacy}" xc:white \( "$SRC" -resize "${k}x${k}" \) \
    -gravity center -composite -depth 8 -define png:color-type=6 "$dir/ic_launcher.png"

  # Legacy round: the same art clipped to a circle.
  c=$(( (legacy - 1) / 2 ))
  magick -size "${legacy}x${legacy}" xc:white \( "$SRC" -resize "${k}x${k}" \) \
    -gravity center -composite -alpha set \
    \( -size "${legacy}x${legacy}" xc:none -fill white -draw "circle $c,$c $((c + c)),$c" \) \
    -compose DstIn -composite -depth 8 -define png:color-type=6 "$dir/ic_launcher_round.png"

  # Adaptive foreground: the mark at 58 % so it sits inside the 66 dp safe circle.
  f=$(( fg * 58 / 100 ))
  magick -size "${fg}x${fg}" xc:none \( "$SRC" -resize "${f}x${f}" \) \
    -gravity center -composite -depth 8 -define png:color-type=6 "$dir/ic_launcher_foreground.png"
done

# Play Store icon: full square, opaque 32-bit PNG. Play applies its own corner mask and
# shadow, so the artwork stays square and the mark sits on the 384 px keyline (75 %).
if [ -n "$PLAY_OUT" ]; then
  magick -size 512x512 xc:white \( "$SRC" -resize 384x384 \) -gravity center -composite \
    -alpha on -depth 8 -define png:color-type=6 "$PLAY_OUT"
  echo "wrote $PLAY_OUT"
fi

echo "launcher icons written under $RES"
