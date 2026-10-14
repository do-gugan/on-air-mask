#!/bin/sh
# ストア提出用の zip を dist/ に作る。
# - 拡張機能の本体だけを入れる（docs や README は含めない）
# - manifest.json の "key" 行を除く（ストアは key を受け付けないため）
# macOS / Linux どちらでも動くよう、sed -i などの非互換な書き方は避けている。
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json)
OUT="$ROOT/dist/on-air-mask-$VERSION-store.zip"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

cp -R background.js content.js guard.css panel.html panel.js panel.css _locales icons LICENSE NOTICE "$TMP/"
sed '/"key":/d' manifest.json > "$TMP/manifest.json"
rm -f "$TMP"/icons/*.svg

mkdir -p "$ROOT/dist"
rm -f "$OUT"
(cd "$TMP" && zip -r -X -q "$OUT" . -x '*.DS_Store')
echo "作成しました: $OUT"
unzip -l "$OUT"
