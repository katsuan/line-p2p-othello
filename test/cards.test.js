// LINE に送るカード（招待・結果）：LINE が受けつける形で、ボタンはあとで押されても困らないものだけ
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { loadScripts } = require("./load.js");
const { checkMessages } = require(path.join(__dirname, "../../q-oqrn/tools/qtest/fake-gas.js"));

const w = loadScripts(["js/game.js", "js/card.js", "js/platform.js"], {
  location: { href: "https://katsuan.github.io/line-p2p-othello/", origin: "https://katsuan.github.io", pathname: "/line-p2p-othello/", search: "", hostname: "katsuan.github.io", protocol: "https:" },
  APP_CONFIG: { liffId: "2009927876-PcLT1IYA" },
  localStorage: { getItem: () => null, setItem() {} },
  document: { querySelector: () => null, body: { appendChild() {}, removeChild() {} } },
});
const P = w.OthelloPlatform;

function cards() {
  return [
    w.OthelloCard.invite("room-abc123def456", "https://liff.line.me/2009927876-PcLT1IYA?room=room-abc123def456&join=1"),
    w.OthelloCard.result({ outcome: "win", myName: "わたし", opponentName: "あいて", mine: 40, theirs: 24 }),
    w.OthelloCard.result({ outcome: "draw", myName: "わたし", opponentName: "あいて", mine: 32, theirs: 32 }),
  ];
}

test("LINE が受けつける形", () => {
  const problems = checkMessages(JSON.parse(JSON.stringify(cards()))).filter((p) => p.level === "error");
  assert.deepStrictEqual(problems, []);
});

test("ボタンは、画面を開く・コピーだけ（あとで押されても困らない）", () => {
  const text = JSON.stringify(cards());
  const types = [...text.matchAll(/"action":\{"type":"(\w+)"/g)].map((m) => m[1]);
  assert.ok(types.length > 0);
  types.forEach((type) => assert.ok(["uri", "clipboard"].includes(type), type));
});
