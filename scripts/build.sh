#!/usr/bin/env bash
# Packages extension/ into site/mainkick.zip (a folder named "mainkick" inside the zip).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cp -r "$root/extension" "$tmp/mainkick"
rm -f "$root/site/mainkick.zip"
(cd "$tmp" && zip -qr -X "$root/site/mainkick.zip" mainkick)
echo "Built site/mainkick.zip ($(du -h "$root/site/mainkick.zip" | cut -f1))"
