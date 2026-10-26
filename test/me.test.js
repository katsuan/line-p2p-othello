// 見出しの本人のアイコン（js/me.js）と、LIFF を2回起こさないつなぎ（js/platform.js）。node --test test/ で動く
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { loadScripts } = require("./load.js");

const read = (name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8");

test("ログイン中は名前と、相手に見えることを出す。版があれば版も", () => {
  const w = loadScripts(["js/me.js"], { document: {} });
  const rows = w.OthelloMe.rows({ me: { name: "かつ", picture: "" }, loggedIn: true, version: "ca81ef4" });
  assert.deepStrictEqual(Array.from(rows, (r) => r.text), [
    "かつ さんでログインしています",
    "友だちとの対戦では、相手にこの名前とアイコンが見えます",
    "版 ca81ef4"
  ]);
});

test("まだログインしていないときは、そのまま遊べるものを出す（記録のうつし方など、ひっくりにないものは出さない）", () => {
  const w = loadScripts(["js/me.js"], { document: {} });
  const texts = w.OthelloMe.rows({ me: null, loggedIn: false }).map((r) => r.text).join("\n");
  assert.match(texts, /まだ LINE にログインしていません/);
  assert.doesNotMatch(texts, /記録の控え|ボット/);
});

test("Q キットの line-me.js を読み、LIFF は platform.js が起こしたものを渡す（2回起こさない）", () => {
  const html = read("index.html");
  assert.match(html, /line-share\/shared\/line-me\.js\?v=\d+" defer/);
  assert.match(html, /js\/me\.js\?v=\d+/);
  const me = read("js/me.js");
  assert.match(me, /bot: false/);
  assert.match(me, /ready: Platform\.liffReady\(\)/);
  assert.doesNotMatch(me, /liff\.init/);
  // LIFF を起こすのは platform.js の1か所だけ
  assert.strictEqual((read("js/platform.js").match(/liff\.init\(/g) || []).length, 1);
});

test("名前は文字として入れる（HTML にしない）", () => {
  assert.doesNotMatch(read("js/me.js"), /innerHTML/);
});

test("アイコンがあるスマホの幅では、版の札を見出しから外す（375px でロゴが名前にかぶらない）", () => {
  assert.match(read("css/page.css"), /@media \(max-width: 480px\)[\s\S]*\.ls-brand\.has-me \.version-badge \{\s*display: none;/);
});
