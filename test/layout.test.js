// 見た目の穴が戻らないかを、CSS の中身で確かめる（せまい画面・暗い表示）。node --test test/ で動く
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const css = (name) => fs.readFileSync(path.join(__dirname, "..", "css", name), "utf8");

// 320px で長いルームIDの行が横にはみ出さない（はじめの欄の列が中身の幅で広がらない）
test("はじめの欄は、せまい画面で中身の幅に広がらない", () => {
  const page = css("page.css");
  assert.match(page, /\.top-actions \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(page, /\.room-overview \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(page, /@media \(max-width: 640px\)[\s\S]*\.top-actions \{\s*min-width: 0;/);
});

// 結果・始めるカードは明るい紙の色なので、暗い表示でも中の字を明るいときの色に
test("暗い表示でも、結果のカードの字は薄くならない", () => {
  const board = css("board.css");
  assert.match(board, /prefers-color-scheme: dark[\s\S]*\.result-card \{[^}]*--ls-subtext: #576459/);
});

// せまい画面では結果のカードを詰めて、盤の中に収める
test("せまい画面では、結果のカードを詰める", () => {
  assert.match(css("board.css"), /@media \(max-width: 400px\)[\s\S]*\.result-card \{[^}]*gap: 8px/);
});
