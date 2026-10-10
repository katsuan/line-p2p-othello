#!/usr/bin/env sh
# questions/ にある問題ファイル（*.json）の一覧を questions/index.json に書き出す。
# GitHub Pages ではフォルダの中身を一覧できないため、公開時（GitHub Actions）に毎回作り直す。
# 問題を増やすときは questions/ に JSON を置くだけでよい（ローカルで試すときはこのスクリプトも実行する）。
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DIR="$ROOT_DIR/questions"
OUT="$DIR/index.json"

first=1
printf '[' > "$OUT"
for file in "$DIR"/*.json; do
  name=$(basename "$file")
  [ "$name" = "index.json" ] && continue
  if [ $first -eq 1 ]; then first=0; else printf ',' >> "$OUT"; fi
  printf '\n  "%s"' "$name" >> "$OUT"
done
printf '\n]\n' >> "$OUT"

printf 'questions/index.json updated: %s\n' "$(tr -d '\n ' < "$OUT")"
