// 対局中に相手から届く知らせ（handlePeerData）：ずるい手・変な中身を受けつけない
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { loadScripts } = require("./load.js");

const XSS = "<img src=x onerror=alert(1)>";

function setup(role, myColor) {
  const sent = [];
  const w = loadScripts(["js/game.js", "js/quiz.js", "js/peer-guard.js", "js/play.js"], {
    setTimeout: () => 0,
    clearTimeout: () => {},
    AppPeer: { isConnected: () => true, send: (m) => sent.push(m), connectTo: () => {} }
  });
  const Game = w.OthelloGame;
  const app = {
    role, myColor, opponentMode: "human", transportMode: "p2p", matchConfigured: true,
    game: Game.createFreshGame(8), rules: w.OthelloQuiz.normalizeRules({}),
    quizAttempts: {}, quizRetries: {}, quizLives: { B: 0, W: 0 },
    rematch: { outgoing: false, incoming: false }, roomId: "room-test", opponentDisplayName: "", opponentPictureUrl: ""
  };
  const log = { com: 0, profile: null, reset: 0 };
  const deps = {
    clearRematch() {}, failed: (m) => m, freshLives: () => ({ B: 0, W: 0 }), getRemotePeerId: () => "",
    render() {}, resetGame() { log.reset += 1; app.game = Game.createFreshGame(app.rules.size); },
    setMessage(m) { if (String(m).includes("COM")) log.com += 1; }, setMode() {}, setOpponentStatus() {}, setTransport() {},
    setOpponentProfile(name, url) { log.profile = { name, url }; }, stopRoomSubscription() {}, stopTimer() {}
  };
  const play = w.OthelloPlay.create(app, deps);
  return { w, app, play, log, Game, sent };
}

test("相手の正しい手は盤面に入る", () => {
  const { app, play } = setup("host", "W");
  play.handlePeerData({ type: "move", color: "B", row: 2, col: 3, version: 1 });
  assert.strictEqual(app.game.board[2][3], "B");
  assert.strictEqual(app.game.currentTurn, "W");
});

test("自分の色で置く・番でない・ルールに合わない手は受けつけない", () => {
  const cases = [
    { type: "move", color: "W", row: 2, col: 4, version: 1 }, // 自分（白）の色
    { type: "move", color: "B", row: 0, col: 0, version: 1 }, // ルールに合わない
    { type: "move", color: "B", row: 99, col: 0, version: 1 },
    { type: "move", color: "B", row: 2, col: 3, version: 5 }, // 版がずれている
    { type: "miss", color: "W", row: 2, col: 4, version: 1 }
  ];
  cases.forEach((data) => {
    const { app, play, Game } = setup("host", "W");
    const before = JSON.stringify(Game.serializeBoard(app.game.board));
    play.handlePeerData(data);
    assert.strictEqual(JSON.stringify(Game.serializeBoard(app.game.board)), before, JSON.stringify(data));
    assert.strictEqual(app.game.version, 0);
  });
});

test("ゲストからの盤面の上書き（state）をホストは受けつけない", () => {
  const { app, play, Game } = setup("host", "B");
  const fake = Array(8).fill("BBBBBBBB");
  play.handlePeerData({ type: "state", board: fake, currentTurn: "", winner: "黒", version: 9, hostColor: "B" });
  assert.notStrictEqual(Game.serializeBoard(app.game.board)[0], "BBBBBBBB");
  assert.strictEqual(app.game.winner, "");
});

test("ゲストは、ホストからの正しい state を受けて盤面をそろえる。変な state は捨てる", () => {
  const { app, play, Game } = setup("guest", "W");
  const board = Game.serializeBoard(Game.createInitialBoard(8));
  play.handlePeerData({ type: "state", board: ["x"], currentTurn: "B", version: 1 });
  assert.strictEqual(app.game.version, 0);
  play.handlePeerData({ type: "state", board, currentTurn: "W", version: 4, winner: "", hostColor: "B", matchConfigured: true, message: XSS });
  assert.strictEqual(app.game.version, 4);
  assert.strictEqual(app.game.currentTurn, "W");
});

test("対局中に、ゲストから次の対局の準備（rematch-setup）が届いても盤面は消えない", () => {
  const { app, play, log } = setup("host", "B");
  play.handlePeerData({ type: "rematch-setup" });
  assert.strictEqual(log.reset, 0);
  assert.strictEqual(app.matchConfigured, true);
  const guest = setup("guest", "W");
  guest.play.handlePeerData({ type: "rematch-setup" }); // 対局中
  assert.strictEqual(guest.log.reset, 0);
});

test("名前と画像：変な中身は文字のまま・LINE の画像だけ", () => {
  const { play, log } = setup("host", "B");
  play.handlePeerData({ type: "profile", displayName: XSS, pictureUrl: "javascript:alert(1)" });
  assert.strictEqual(log.profile.name, XSS.slice(0, 40));
  assert.strictEqual(log.profile.url, "");
});

test("どんな変な知らせでも落ちない", () => {
  const weird = [null, undefined, 1, "move", [], {}, { type: 5 }, { type: "move" }, { type: "state" },
    { type: "resume-preview", payload: 5 }, { type: "resume-continue" }, { type: "quiz-choice", chosen: {} },
    { type: "start", hostColor: XSS }, { type: "setup-sync", rules: XSS, hostColor: [] }, { type: "__proto__" },
    { type: "start-ready", rules: { size: "x" } }, { type: "quiz-open", row: "a", col: {} }];
  weird.forEach((data) => {
    const { play } = setup("guest", "W");
    assert.doesNotThrow(() => play.handlePeerData(data), JSON.stringify(data));
  });
});

test("ゲストは、ホストの色決めの知らせで正しい色だけ受けつける", () => {
  const { app, play } = setup("guest", "W");
  app.matchConfigured = false;
  play.handlePeerData({ type: "start", hostColor: "purple" });
  assert.strictEqual(app.matchConfigured, false);
  play.handlePeerData({ type: "start", hostColor: "W" });
  assert.strictEqual(app.matchConfigured, true);
  assert.strictEqual(app.myColor, "B");
});
