// つながりが切れた・相手が抜けた・同時に押した・再戦（node --test test/）
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { loadScripts } = require("./load.js");

function setup(role, myColor, opts) {
  const sent = [];
  const peer = { connected: true };
  const w = loadScripts(["js/game.js", "js/quiz.js", "js/peer-guard.js", "js/play.js"], {
    setTimeout: () => 0,
    clearTimeout: () => {},
    AppPeer: { isConnected: () => peer.connected, send: (m) => sent.push(m), connectTo: (id) => sent.push({ connectTo: id }) }
  });
  const Game = w.OthelloGame;
  const app = Object.assign({
    role, myColor, opponentMode: "human", transportMode: "p2p", matchConfigured: true,
    game: Game.createFreshGame(8), rules: w.OthelloQuiz.normalizeRules({}),
    quizAttempts: {}, quizRetries: {}, quizLives: { B: 0, W: 0 }, desiredHostColor: "B", currentHostColor: "B",
    rematch: { outgoing: false, incoming: false }, roomId: "room-test", opponentDisplayName: "", opponentPictureUrl: "",
    pendingPeerTarget: "", reconnecting: false, localStartReady: false, remoteStartReady: false
  }, opts || {});
  const log = { reset: 0, messages: [] };
  const deps = {
    clearRematch() { app.rematch.outgoing = false; app.rematch.incoming = false; }, failed: (m) => m,
    freshLives: () => ({ B: 0, W: 0 }), getRemotePeerId: () => "peer-other",
    render() {}, resetGame() { log.reset += 1; app.game = Game.createFreshGame(app.rules.size); },
    setMessage(m) { log.messages.push(m); }, setMode() {}, setOpponentStatus() {}, setTransport() {},
    setOpponentProfile() {}, stopRoomSubscription() {}, stopTimer() {}
  };
  const play = w.OthelloPlay.create(app, deps);
  return { w, app, play, log, Game, sent, peer };
}

function types(sent) {
  return sent.map((m) => m.type).filter(Boolean);
}

test("対局中にホストがページを開きなおして相手とつながったら、ホストが盤面を送って手を届けられるようにする", () => {
  // 開きなおした直後：この端末の記録から対局中に戻るが、通信の形はまだ「マッチング」
  const { app, play, sent } = setup("host", "B", { transportMode: "matchmaking" });
  app.game.version = 3;
  play.startP2PPlay();
  assert.ok(types(sent).includes("state"), JSON.stringify(types(sent)));
  assert.strictEqual(app.transportMode, "p2p");
});

test("対局中にゲストが開きなおしたら、ホストの盤面が届くのを待つ（自分からは盤面を送らない）", () => {
  const { app, play, sent } = setup("guest", "W", { transportMode: "matchmaking" });
  play.startP2PPlay();
  assert.ok(!types(sent).includes("state"));
  assert.strictEqual(app.matchConfigured, true);
});

test("2人が同時に「もう一戦する」を押したら、聞き返さずに次の準備へ進む", () => {
  const host = setup("host", "B");
  host.app.game.winner = "黒";
  host.play.requestRematch();
  host.play.handlePeerData({ type: "rematch-request" });
  assert.ok(types(host.sent).includes("rematch-setup"));
  assert.strictEqual(host.app.rematch.incoming, false);
  assert.strictEqual(host.app.matchConfigured, false);

  const guest = setup("guest", "W");
  guest.app.game.winner = "黒";
  guest.play.requestRematch();
  guest.play.handlePeerData({ type: "rematch-request" });
  assert.strictEqual(guest.app.rematch.incoming, false, "ゲストに「受ける？」を出さない");
  guest.play.handlePeerData({ type: "rematch-setup" });
  assert.strictEqual(guest.app.matchConfigured, false);
});

test("再戦のお願いの返事待ちが時間切れになったあとで、相手が受けても次の準備へ進む", () => {
  const { app, play, sent } = setup("host", "B");
  app.game.winner = "白";
  app.rematch.outgoing = false; // 返事待ちは時間切れ
  play.handlePeerData({ type: "rematch-accept" });
  assert.ok(types(sent).includes("rematch-setup"));
  assert.strictEqual(app.matchConfigured, false);
});

test("対局中に再戦の返事（rematch-accept）が届いても、盤面は消えない", () => {
  const { app, play, sent, log } = setup("host", "B");
  play.handlePeerData({ type: "rematch-accept" });
  assert.strictEqual(log.reset, 0);
  assert.ok(!types(sent).includes("rematch-setup"));
  assert.strictEqual(app.matchConfigured, true);
});

test("色を変えたのと同時に相手が START したら、古い色の START は準備OKにしない", () => {
  const { app, play } = setup("host", "B", { matchConfigured: false });
  app.desiredHostColor = "W"; // ホストが白に変えた（setup-sync は相手へ向かっている途中）
  play.handlePeerData({ type: "start-ready", hostColor: "B" });
  assert.strictEqual(app.remoteStartReady, false);
  assert.strictEqual(app.desiredHostColor, "W");
  play.handlePeerData({ type: "start-ready", hostColor: "W" });
  assert.strictEqual(app.remoteStartReady, true);
});

test("合図の線（シグナリング）だけ切れて、相手とのつながりが生きていれば、対局はそのまま", () => {
  const { app, play } = setup("host", "B");
  play.handleLinkLost("通信が切れました。");
  assert.strictEqual(app.reconnecting, false);
  assert.strictEqual(app.transportMode, "p2p");
});

test("相手とのつながりが切れたら、再接続を始める", () => {
  const { app, play, peer, sent } = setup("host", "B");
  peer.connected = false;
  play.handleLinkLost("相手との接続が切れました。");
  assert.strictEqual(app.reconnecting, true);
  assert.ok(sent.some((m) => m.connectTo === "peer-other"));
});

test("相手がいない（peer-unavailable）ときは、待っている相手の印を消して、次の試しでまたつなぎにいく", () => {
  const { app, play, peer, sent } = setup("guest", "W");
  peer.connected = false;
  play.connectToRemotePeer("peer-other");
  play.connectToRemotePeer("peer-other"); // 返事を待っている間は重ねない
  assert.strictEqual(sent.filter((m) => m.connectTo).length, 1);
  play.handlePeerUnavailable();
  assert.strictEqual(app.pendingPeerTarget, "");
  play.connectToRemotePeer("peer-other");
  assert.strictEqual(sent.filter((m) => m.connectTo).length, 2);
});
