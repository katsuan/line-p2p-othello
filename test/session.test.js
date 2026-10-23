// 画面をにせものにして、session.js（ルームに入る・相手が抜けた）を通して動かす
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { loadScripts } = require("./load.js");

function setup(search, room) {
  const timers = [];
  const writes = [];
  let handlers = null;
  let app = null;
  const peer = { connected: false };
  const store = {};
  const w = loadScripts(["js/game.js", "js/quiz.js", "js/peer-guard.js", "js/play.js", "js/session.js"], {
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    location: { search: search || "", href: "https://example.test/" },
    history: { replaceState() {} },
    sessionStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } },
    localStorage: { getItem: () => null, setItem() {} },
    document: { body: { classList: { remove() {} } }, hidden: false, title: "" },
    navigator: {},
    OthelloUI: { create: () => ({ render: (a) => { app = a; }, bind() {}, showToast() {}, getRoomInput: () => "" }) },
    OthelloPlatform: {
      getAppBaseUrl: () => "https://example.test/", loadVersionInfo: () => Promise.resolve(""),
      initIdentity: () => Promise.resolve({ userId: "U1", displayName: "わたし", pictureUrl: "" }),
      hashUserId: () => Promise.resolve("uhash1"), sanitizeForPeer: (v) => String(v).replace(/[^a-zA-Z0-9_-]/g, "")
    },
    OthelloMatchmaking: {
      init() {}, resolveEntry: (d, u, j) => (!d ? (j ? "missing" : "create-host") : d.hostUserId === u ? "resume-host" : "join-guest"),
      fetchRoom: () => Promise.resolve(room || null),
      createHostRoom: (...a) => { writes.push(["create", ...a]); return Promise.resolve(); },
      resetHostRoom: (...a) => { writes.push(["reset", ...a]); return Promise.resolve(); },
      joinGuestRoom: (...a) => { writes.push(["join", ...a]); return Promise.resolve(); },
      promoteGuestToHost: (...a) => { writes.push(["promote", ...a]); return Promise.resolve(); },
      subscribeRoom: () => () => {}, getRemotePeerId: (d, role) => (!d ? "" : role === "host" ? d.guestPeerId || "" : d.hostPeerId || "")
    },
    AppPeer: {
      init: (id, h) => { handlers = h; h.onPeerOpen(id); return Promise.resolve(id); },
      isConnected: () => peer.connected, send() {}, connectTo() {}, disconnect() {}
    },
    APP_CONFIG: {}, URLSearchParams
  });
  w.OthelloSession.create().bootstrap();
  const flush = () => new Promise((r) => setImmediate(r));
  return { w, timers, writes, peer, flush, get app() { return app; }, get handlers() { return handlers; } };
}

test("友だちが抜けて戻らないとき、ホストは参加待ちに戻り、再接続中の帯は消える", async () => {
  const s = setup("?room=room-abc123");
  for (let i = 0; i < 5; i += 1) await s.flush();
  assert.strictEqual(s.app.role, "host");
  s.app.roomData = { roomId: "room-abc123", hostUserId: "uhash1", hostPeerId: "p", guestUserId: "uguest", guestPeerId: "guest-peer" }; // ルームの見張りで届いた中身
  s.peer.connected = true;
  s.handlers.onConnectionOpen();
  assert.strictEqual(s.app.transportMode, "p2p");
  s.peer.connected = false;
  s.handlers.onConnectionClose();
  assert.strictEqual(s.app.reconnecting, true);
  // 再接続の待ち時間が過ぎた
  s.timers.filter((t) => t.ms === 8000).forEach((t) => t.fn());
  for (let i = 0; i < 5; i += 1) await s.flush();
  assert.ok(s.writes.some((x) => x[0] === "reset"));
  assert.strictEqual(s.app.reconnecting, false);
  assert.strictEqual(s.app.transportMode, "matchmaking");
  assert.strictEqual(s.app.roomData.guestPeerId, "");
});

test("ホストが抜けて戻らないとき、対局前のゲストはルームを引き継ぎ、再接続中の帯は消える", async () => {
  const s = setup("?room=room-abc123&join=1", { roomId: "room-abc123", hostUserId: "uhost", hostPeerId: "host-peer", guestUserId: "", guestPeerId: "" });
  for (let i = 0; i < 5; i += 1) await s.flush();
  assert.strictEqual(s.app.role, "guest");
  s.peer.connected = true;
  s.handlers.onConnectionOpen();
  s.peer.connected = false;
  s.handlers.onConnectionClose();
  s.timers.filter((t) => t.ms === 8000).forEach((t) => t.fn());
  for (let i = 0; i < 5; i += 1) await s.flush();
  assert.ok(s.writes.some((x) => x[0] === "promote"));
  assert.strictEqual(s.app.role, "host");
  assert.strictEqual(s.app.reconnecting, false);
  assert.strictEqual(s.app.transportMode, "matchmaking");
});
