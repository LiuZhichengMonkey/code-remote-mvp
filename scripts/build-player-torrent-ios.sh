#!/usr/bin/env bash
set -euo pipefail
# ponytail: rung 5 - build the pinned Go BT engine for each Apple SDK; no prebuilt binary host.
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
native_out="$repo_root/runtime/player-torrent-native"
mkdir -p "$native_out"
cd "$repo_root/apps/mobile/torrent_engine"
for sdk in iphoneos iphonesimulator; do
  sdk_path="$(xcrun --sdk "$sdk" --show-sdk-path)"
  if [ "$sdk" = iphoneos ]; then target=arm64-apple-ios13.0; else target=arm64-apple-ios13.0-simulator; fi
  CGO_ENABLED=1 GOOS=ios GOARCH=arm64 CC="$(xcrun --sdk "$sdk" --find clang)" \
    CGO_CFLAGS="-isysroot $sdk_path -target $target" \
    CGO_LDFLAGS="-isysroot $sdk_path -target $target" \
    go build -trimpath -tags 'nosqlite,disable_libutp' -buildmode=c-archive -o "$native_out/$sdk.a" ./bridge
done
