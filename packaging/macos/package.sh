#!/usr/bin/env bash
# Builds MdCraft.app (universal) and a .dmg with a background window.   ./packaging/macos/package.sh
#   DMG_BACKGROUND=my.png   another background (640x400; my@2x.png next to it is used for Retina)
#   DMG_LAYOUT=0            skip the Finder window layout (no background; for headless builds)
# The layout step drives Finder: allow Terminal to control Finder when macOS asks
# (System Settings → Privacy & Security → Automation).
# Sign afterwards with: codesign --deep --force --options runtime -s "Developer ID Application: …" dist/MdCraft.app
set -euo pipefail
cd "$(dirname "$0")/../.."
VERSION=$(grep -m1 '^version' Cargo.toml | cut -d'"' -f2)
export MACOSX_DEPLOYMENT_TARGET=11.0
rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null
for t in aarch64-apple-darwin x86_64-apple-darwin; do cargo build --release --target $t -p mdcraft -p mdcraft-cli; done
APP=dist/MdCraft.app
rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
for b in mdcraft mdcraft-cli; do
  lipo -create target/aarch64-apple-darwin/release/$b target/x86_64-apple-darwin/release/$b -output "$APP/Contents/MacOS/$b"
done
sed "s/@VERSION@/$VERSION/g" packaging/macos/Info.plist.in > "$APP/Contents/Info.plist"
cp assets/app-icon/mdcraft.icns "$APP/Contents/Resources/mdcraft.icns"
DMG="dist/MdCraft-$VERSION-macos-universal.dmg"
VOL="MdCraft"                                              # volume name shown in Finder
APP_NAME=$(basename "$APP")                                # MdCraft.app
BG="${DMG_BACKGROUND:-packaging/macos/dmg-background.png}" # 640x400
BG2X="${BG%.png}@2x.png"                                   # optional 1280x800 for Retina
WIN_W=640; WIN_H=400                                       # window size; match the background

# `diskutil image` (macOS 26+) replaces hdiutil, which is deprecated; older systems use hdiutil.
MACOS_MAJOR=$(sw_vers -productVersion | cut -d. -f1)
if [ "$MACOS_MAJOR" -ge 26 ]; then IMG=diskutil; else IMG=hdiutil; fi
echo "Making the .dmg with $IMG"

trap 'echo "error: packaging/macos/package.sh failed at line $LINENO: $BASH_COMMAND" >&2' ERR
WORK=$(mktemp -d "${TMPDIR:-/tmp}/mdcraft-dmg.XXXXXX")
RW="$WORK/MdCraft-rw.dmg"
DEVICE=""
eject_device() { # eject, retrying while Spotlight or a scanner still holds the volume
  local dev="$1"
  for _ in 1 2 3 4 5; do
    diskutil eject "$dev" >/dev/null 2>&1 && return 0
    echo "  the disk image is still busy, retrying in 2 s…" >&2; sleep 2
  done
  diskutil unmountDisk force "$dev" >/dev/null 2>&1 || true
  diskutil eject "$dev" >/dev/null 2>&1
}
cleanup() {
  if [ -n "$DEVICE" ]; then eject_device "$DEVICE" || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

# 0. An MdCraft volume that is still mounted (an earlier .dmg) would make this one "MdCraft 1",
#    and Finder saves the window layout for the volume name: eject it first.
for vol in /Volumes/"$VOL" /Volumes/"$VOL "[0-9]*; do
  if [ -d "$vol" ]; then echo "Ejecting $vol"; diskutil eject "$vol" >/dev/null 2>&1 || diskutil unmount force "$vol" >/dev/null 2>&1 || true; fi
done

# 1. A blank writable image: the app plus headroom (there is no writable `create from`).
APP_MB=$(du -sm "$APP" | awk '{print $1}')
SIZE_MB=$(( APP_MB + APP_MB / 5 + 20 ))
if [ "$IMG" = diskutil ]; then
  diskutil image create blank --size "${SIZE_MB}m" --volumeName "$VOL" "$RW" >/dev/null
else
  hdiutil create -quiet -size "${SIZE_MB}m" -fs HFS+ -volname "$VOL" "$RW" 2>&1 | grep -v "deprecated" || true
fi
[ -f "$RW" ] || { echo "error: could not create the disk image" >&2; exit 1; }

# 2. Attach it browsable (not -nobrowse: Finder has to see it to save the window layout).
if [ "$IMG" = diskutil ]; then ATTACH_OUT=$(diskutil image attach "$RW"); else ATTACH_OUT=$(hdiutil attach "$RW" -noautoopen -noverify); fi
DEVICE=$(echo "$ATTACH_OUT" | grep -E '^/dev/disk' | head -1 | awk '{print $1}' || true)
[ -n "$DEVICE" ] || { echo "error: could not attach the disk image:" >&2; echo "$ATTACH_OUT" >&2; exit 1; }
# The mount point is in the attach output ("/dev/disk8s1  41504653-…  /Volumes/MdCraft").
# Don't look it up by $DEVICE: an APFS image mounts on a separate container disk (disk8s1
# for disk7). Otherwise wait for /Volumes/$VOL to appear.
MNT=$(echo "$ATTACH_OUT" | grep -o '/Volumes/.*$' | sed -E 's/[[:space:]]+$//' | head -1 || true)
if [ -z "$MNT" ]; then
  for _ in $(seq 1 20); do [ -d "/Volumes/$VOL" ] && break; sleep 0.5; done
  MNT="/Volumes/$VOL"
fi
[ -d "$MNT" ] || { echo "error: the disk image did not mount (expected $MNT). diskutil said:" >&2; echo "$ATTACH_OUT" >&2; exit 1; }
[ "$(basename "$MNT")" = "$VOL" ] || { echo "error: the image mounted as $MNT, not /Volumes/$VOL (eject the other $VOL volume)" >&2; exit 1; }
mdutil -i off "$MNT" >/dev/null 2>&1 || true

# 3. Contents: the app, an Applications shortcut, and the background in a hidden folder.
ditto "$APP" "$MNT/$APP_NAME"
ln -s /Applications "$MNT/Applications"
BG_FILE=""
if [ "${DMG_LAYOUT:-1}" != 0 ]; then
  [ -f "$BG" ] || { echo "error: no background image at $BG (set DMG_BACKGROUND, or DMG_LAYOUT=0)" >&2; exit 1; }
  mkdir "$MNT/.background"
  if [ -f "$BG2X" ] && command -v tiffutil >/dev/null; then
    # one file with both sizes: Finder picks the sharp one on Retina screens
    tiffutil -cathidpicheck "$BG" "$BG2X" -out "$MNT/.background/background.tiff" >/dev/null 2>&1
    BG_FILE="background.tiff"
  else
    cp "$BG" "$MNT/.background/background.png"
    BG_FILE="background.png"
  fi
fi

# 4. Lay out the window with Finder; it saves the layout in .DS_Store on the volume.
if [ -n "$BG_FILE" ]; then
  echo "Laying out the window in Finder…"
  if ! osascript <<APPLESCRIPT
tell application "Finder"
  tell disk "$VOL"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {100, 100, $((100 + WIN_W)), $((100 + WIN_H))}
    set opts to the icon view options of container window
    set arrangement of opts to not arranged
    set icon size of opts to 128
    set text size of opts to 13
    set background picture of opts to file ".background:$BG_FILE"
    set position of item "$APP_NAME" of container window to {160, 200}
    set position of item "Applications" of container window to {480, 200}
    update without registering applications
    delay 2
    close
  end tell
end tell
APPLESCRIPT
  then
    echo "error: Finder could not lay out the window. Allow Terminal to control Finder in System Settings" >&2
    echo "       → Privacy & Security → Automation, then run this again (or DMG_LAYOUT=0 for no background)." >&2
    exit 1
  fi
  # wait until Finder has written the layout
  for _ in $(seq 1 20); do [ -f "$MNT/.DS_Store" ] && break; sleep 0.5; done
  [ -f "$MNT/.DS_Store" ] || echo "warning: Finder did not save the window layout (.DS_Store); the background may not show" >&2
fi
chmod -Rf go-w "$MNT" 2>/dev/null || true
sync

# 5. Eject (there is no `diskutil image detach`), then compress to a read-only .dmg.
eject_device "$DEVICE" || { echo "error: could not eject $DEVICE" >&2; exit 1; }
DEVICE=""
rm -f "$DMG"
if [ "$IMG" = diskutil ]; then
  diskutil image create from "$RW" "$DMG" --format UDZO >/dev/null
else
  hdiutil convert "$RW" -quiet -format UDZO -imagekey zlib-level=9 -o "$DMG"
fi
[ -f "$DMG" ] || { echo "error: could not compress $DMG" >&2; exit 1; }
echo
echo "Built: $APP"
echo "Built: $DMG"
