// 案内の文が、今の画面にあるボタン・欄の名前を指しているか（名前を変えたときに案内だけ古くならないように）
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const all = () => ["index.html", "app.js", "js/ui.js", "js/play.js", "js/session.js", "js/platform.js"].map(read).join("\n");

test("案内で「」に入れたボタン・欄の名前は、画面に同じ名前である", () => {
  const ui = read("js/ui.js");
  const html = read("index.html");
  // 友だち待ちの START の文字
  assert.match(ui, /startLabel = !rulesReady \? startLabel : "▶ 待つ間 COM と練習する"/);
  assert.match(ui, /「▶ 待つ間 COM と練習する」で練習できます/);
  // 結果のボタン
  assert.match(ui, /"🔁 もう一戦する"/);
  assert.match(ui, /盤面の「🔁 もう一戦する」で続けられます/);
  // 欄の名前
  assert.match(html, /<div class="setup-heading">対局の準備<\/div>/);
  assert.match(ui, /toolsSummary: "別のルームに参加 \/ 新しい対局"/);
  assert.match(html, /<summary id="roomToolsSummary">ルームIDで参加<\/summary>/);
  assert.match(html, /👥 友だちと対戦/);
});

test("もうない操作（新しいルームを作成・ページを開き直す）を、続けかたとして案内しない", () => {
  const code = all();
  assert.doesNotMatch(code, /新しいルームを作成/);
  assert.doesNotMatch(code, /続ける場合は/);
});

test("結果を閉じたあとの知らせは、画面に出る（知らせの欄に出す言葉に入っている）", () => {
  assert.match(read("js/ui.js"), /\|結果を閉じ\|/);
  assert.match(read("js/session.js"), /"結果を閉じました。/);
});

test("教養の呼び名は「📚 教養モード」にそろえる", () => {
  assert.doesNotMatch(all(), /教養ルール/);
});
