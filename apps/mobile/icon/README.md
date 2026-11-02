# Avatar Companion icon

`background.svg` and `mark.svg` are the source of the app icon. The mark is a head-and-shoulders
figure with two orbit rings. It is the same avatar design as the icon on the README and the org
profile. It is not the Companion Intelligence logo.

Render the master first, from this folder, with librsvg and ImageMagick:

    rsvg-convert -w 1024 -h 1024 background.svg -o background.png
    rsvg-convert -w 1024 -h 1024 mark.svg -o mark.png
    magick background.png mark.png -composite -alpha off master.png

Then:

- **iOS:** copy `master.png` to `apps/mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`.
  It must stay 1024 x 1024 and opaque.
- **Android:** run `apps/mobile/scripts/android-icons.sh`. The adaptive background colour lives in
  `android/app/src/main/res/values/ic_launcher_background.xml`.
- **Desktop:** round the corners of `master.png` (radius 229 px, transparent outside), then resize into
  `apps/desktop/src-tauri/icons/`. Build `icon.icns` with `iconutil` from an `.iconset` folder, and
  `icon.ico` with ImageMagick's `icon:auto-resize`.
- **Web:** `apps/web/public/icons/` has the rounded PWA icons, an opaque 180 px apple-touch icon, a
  maskable icon with the mark at 70 %, and `avatar-icon.svg` as the favicon.

The iOS launch screen is still the stock Capacitor placeholder. It has its own asset and is not
covered here.
