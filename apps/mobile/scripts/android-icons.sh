#!/usr/bin/env bash
# Rebuilds the Android launcher icons (legacy square, legacy round and the adaptive
# foreground) from the avatar icon sources in apps/mobile/icon/. Optionally writes the
# 512 px Play Store icon too.
#
#   apps/mobile/scripts/android-icons.sh [play-icon-out.png]
#
# Needs ImageMagick (magick) and librsvg (rsvg-convert). background.svg is the full-bleed
# gradient that the legacy icons use, and mark.svg is the transparent avatar mark that the
# adaptive foreground uses. The adaptive background is the solid colour in
# values/ic_launcher_background.xml, which should match the middle of the gradient.
set -euo pipefail

MOBILE="$(cd "$(dirname "$0")/.." && pwd)"
RES="$MOBILE/android/app/src/main/res"
ICON="$MOBILE/icon"
PLAY_OUT="${1:-}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

command -v magick >/dev/null || { echo "magick (ImageMagick) not found" >&2; exit 1; }
command -v rsvg-convert >/dev/null || { echo "rsvg-convert (librsvg) not found" >&2; exit 1; }

rsvg-convert -w 1024 -h 1024 "$ICON/background.svg" -o "$TMP/background.png"
rsvg-convert -w 1024 -h 1024 "$ICON/mark.svg" -o "$TMP/mark.png"
magick "$TMP/background.png" "$TMP/mark.png" -composite -alpha off "$TMP/master.png"

# density:legacy launcher px:adaptive foreground px (108 dp at that density)
for entry in mdpi:48:108 hdpi:72:162 xhdpi:96:216 xxhdpi:144:324 xxxhdpi:192:432; do
  IFS=: read -r density legacy fg <<< "$entry"
  dir="$RES/mipmap-$density"
  mkdir -p "$dir"

  # Legacy square: the full artwork, opaque, for devices below API 26.
  magick "$TMP/master.png" -resize "${legacy}x${legacy}" -define png:color-type=2 "$dir/ic_launcher.png"

  # Legacy round: the same artwork clipped to a circle.
  c=$(( (legacy - 1) / 2 ))
  magick "$TMP/master.png" -resize "${legacy}x${legacy}" -alpha set \
    \( -size "${legacy}x${legacy}" xc:none -fill white -draw "circle $c,$c $((c + c)),$c" \) \
    -compose DstIn -composite -depth 8 -define png:color-type=6 "$dir/ic_launcher_round.png"

  # Adaptive foreground: the mark at 76 % of the canvas, so the outer ring stays inside the
  # 66 dp safe circle.
  k=$(( fg * 76 / 100 ))
  magick -size "${fg}x${fg}" xc:none \( "$TMP/mark.png" -resize "${k}x${k}" \) \
    -gravity center -composite -depth 8 -define png:color-type=6 "$dir/ic_launcher_foreground.png"
done

# Play Store icon: full square, opaque PNG. Play applies its own corner mask.
if [ -n "$PLAY_OUT" ]; then
  magick "$TMP/master.png" -resize 512x512 -alpha off -define png:color-type=2 "$PLAY_OUT"
  echo "wrote $PLAY_OUT"
fi

echo "launcher icons written under $RES"
