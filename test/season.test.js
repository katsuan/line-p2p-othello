// 季節の絵文字：うれしい瞬間の短い文にだけ。QSeason がなくても動く
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { loadScripts } = require("./load.js");

function endGame(extra) {
  const messages = [];
  const w = loadScripts(["js/game.js", "js/quiz.js", "js/peer-guard.js", "js/play.js"], Object.assign({
    setTimeout: () => 0, clearTimeout() {},
    AppPeer: { isConnected: () => false, send() {} }
  }, extra || {}));
  const Game = w.OthelloGame;
  const app = { role: "host", myColor: "B", opponentMode: "com", transportMode: "com", localTwoPlayer: true, matchConfigured: true,
    game: Game.createFreshGame(8), rules: w.OthelloQuiz.normalizeRules({}), quizAttempts: {}, quizRetries: {}, quizLives: { B: 0, W: 0 },
    rematch: { outgoing: false, incoming: false } };
  // 黒が1手で全部取って終わる盤面
  app.game.board = Game.deserializeBoard(["BW......", "........", "........", "........", "........", "........", "........", "........"]);
  app.game.board[0][2] = "";
  const QSeason = (extra || {}).QSeason;
  const deps = { withSeason: (t) => (QSeason ? QSeason.decorate(t) : t), clearRematch() {}, failed: (m) => m, freshLives: () => ({}), getRemotePeerId: () => "", render() {}, resetGame() {},
    setMessage: (m) => messages.push(m), setMode() {}, setOpponentStatus() {}, setTransport() {}, setOpponentProfile() {}, stopRoomSubscription() {}, stopTimer() {} };
  const play = w.OthelloPlay.create(app, deps);
  play.sendMove(0, 2);
  return { app, messages };
}

test("対局が終わったひとことに、季節の絵文字（盤面の記録には入れない）", () => {
  const { app, messages } = endGame({ QSeason: { decorate: (t) => t + " 🎃" } });
  assert.strictEqual(app.game.winner, "黒");
  assert.match(messages[messages.length - 1], / 🎃$/);
  assert.ok(!app.game.message.includes("🎃"));
});

test("QSeason がまだ読めていなくても、そのまま動く", () => {
  const { messages } = endGame();
  assert.ok(!/🎃/.test(messages[messages.length - 1]));
  assert.match(messages[messages.length - 1], /ゲーム終了/);
});

test("途中の手のお知らせには入れない", () => {
  const messages = [];
  const w = loadScripts(["js/game.js", "js/quiz.js", "js/peer-guard.js", "js/play.js"], {
    setTimeout: () => 0, clearTimeout() {}, AppPeer: { isConnected: () => false, send() {} }, QSeason: { decorate: (t) => t + " 🎃" } });
  const Game = w.OthelloGame;
  const app = { role: "host", myColor: "B", opponentMode: "com", transportMode: "com", localTwoPlayer: true, matchConfigured: true,
    game: Game.createFreshGame(8), rules: w.OthelloQuiz.normalizeRules({}), quizAttempts: {}, quizRetries: {}, quizLives: {}, rematch: {} };
  const play = w.OthelloPlay.create(app, { stopTimer() {}, setMessage: (m) => messages.push(m), render() {}, withSeason: (t) => t + " 🎃" });
  play.sendMove(2, 3);
  assert.ok(!messages.some((m) => m.includes("🎃")));
});

test("招待・結果を送ったお知らせに、季節の絵文字", async () => {
  const w = loadScripts(["js/game.js", "js/card.js", "js/platform.js"], {
    location: { href: "https://x/", origin: "https://x", pathname: "/", search: "", hostname: "x", protocol: "https:" },
    APP_CONFIG: { liffId: "1-a" }, localStorage: { getItem: () => null, setItem() {} },
    document: { querySelector: () => null, body: { appendChild() {}, removeChild() {} } },
    QSeason: { decorate: (t) => t + " 🎃" },
    liff: { isApiAvailable: () => true, isInClient: () => true, shareTargetPicker: () => Promise.resolve({ status: "success" }) }
  });
  const result = await w.OthelloPlatform.shareResult({ outcome: "win", myName: "a", opponentName: "b", mine: 40, theirs: 24 });
  assert.strictEqual(result.message, "結果を送りました。 🎃");
  // やめたときのお知らせには付けない
  w.liff.shareTargetPicker = () => Promise.resolve(undefined);
  const cancelled = await w.OthelloPlatform.shareResult({ outcome: "win", myName: "a", opponentName: "b", mine: 1, theirs: 2 });
  assert.strictEqual(cancelled.message, "送るのをやめました。");
});
