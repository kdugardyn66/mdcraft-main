#!/usr/bin/env bash
# Builds MdCraft.app (universal) and a .dmg.   ./packaging/macos/package.sh
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

# The .dmg, step by step. The one-liner `hdiutil create -srcfolder` often fails at its last
# step with "Resource busy": Spotlight or a security scanner still holds the temporary image
# when hdiutil unmounts it, and it gives up. Here the image is mounted hidden with Spotlight
# off, unmounted with retries (forced if needed), then compressed.
# An MdCraft disk image that is still mounted (an earlier .dmg opened to install) is ejected.
for vol in /Volumes/MdCraft*; do
  if [ -d "$vol" ]; then echo "Ejecting $vol"; hdiutil detach "$vol" -quiet || hdiutil detach "$vol" -force -quiet || true; fi
done
WORK=$(mktemp -d "${TMPDIR:-/tmp}/mdcraft-dmg.XXXXXX")
RW="$WORK/MdCraft-rw.dmg"
MNT="$WORK/mnt"
cleanup() {
  if mount | grep -q " on $MNT "; then hdiutil detach "$MNT" -force -quiet || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT
mkdir -p "$MNT"
SIZE_MB=$(( $(du -sm "$APP" | cut -f1) + 40 ))
hdiutil create -quiet -size "${SIZE_MB}m" -fs HFS+ -volname MdCraft "$RW" 2>&1 | grep -v "is deprecated" || true
[ -f "$RW" ] || { echo "error: could not create the disk image" >&2; exit 1; }
hdiutil attach "$RW" -nobrowse -noautoopen -noverify -mountpoint "$MNT" -quiet
mdutil -i off "$MNT" >/dev/null 2>&1 || true
touch "$MNT/.metadata_never_index"
ditto "$APP" "$MNT/MdCraft.app"
ln -s /Applications "$MNT/Applications"
sync
detached=no
for _ in 1 2 3 4 5; do
  if hdiutil detach "$MNT" -quiet; then detached=yes; break; fi
  echo "disk image still busy, retrying in 2 s…" >&2; sleep 2
done
if [ "$detached" = no ]; then hdiutil detach "$MNT" -force -quiet; fi
rm -f "$DMG"
hdiutil convert "$RW" -quiet -format UDZO -imagekey zlib-level=9 -o "$DMG"
echo
echo "Built: $APP"
echo "Built: $DMG"
