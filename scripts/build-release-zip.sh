#!/bin/sh
# GitHub Release に添付する手動インストール用の zip を dist/ に作る。
# - 拡張機能の本体と LICENSE・NOTICE・README・PRIVACY だけを入れる
# - manifest.json の "key" は残す（フォルダを移動しても拡張機能 ID と保存したマスクが変わらないように）
# - zip を展開すると on-air-mask-<version>/ フォルダができ、その中に manifest.json がある
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json)
NAME="on-air-mask-$VERSION"
OUT="$ROOT/dist/$NAME.zip"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

mkdir "$TMP/$NAME"
cp -R manifest.json background.js content.js guard.css panel.html panel.js panel.css _locales icons \
  LICENSE NOTICE README.md PRIVACY.md "$TMP/$NAME/"
rm -f "$TMP/$NAME"/icons/*.svg

mkdir -p "$ROOT/dist"
rm -f "$OUT"
(cd "$TMP" && zip -r -X -q "$OUT" "$NAME" -x '*.DS_Store')
echo "作成しました: $OUT"
unzip -l "$OUT"
