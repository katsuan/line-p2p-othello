#!/usr/bin/env sh
# 公開時に index.html の js/*.js・css/*.css の URL に ?v=<コミット> を付ける。
# LINE のアプリ内ブラウザなどが古い JS / CSS を使い続けないようにするため（リポジトリの index.html は書き換えない）。
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
VERSION=${GITHUB_SHA:-}

if [ -n "$VERSION" ]; then
  VERSION=$(printf '%s' "$VERSION" | cut -c1-7)
else
  VERSION=$(git -C "$ROOT_DIR" rev-parse --short HEAD)
fi

sed -i.bak -E \
  -e "s#(src=\"js/[A-Za-z0-9_.-]+\.js)\"#\1?v=$VERSION\"#g" \
  -e "s#(href=\"css/[A-Za-z0-9_.-]+\.css)\"#\1?v=$VERSION\"#g" \
  "$ROOT_DIR/index.html"
rm -f "$ROOT_DIR/index.html.bak"

printf 'index.html assets stamped: ?v=%s (%s files)\n' "$VERSION" "$(grep -c "?v=$VERSION" "$ROOT_DIR/index.html")"
