// PeerJS の入れ物（js/webrtc.js）：合図の線が切れたらつなぎなおす・古い線が閉じても今の線は残す
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { loadScripts } = require("./load.js");

function emitter() {
  const handlers = {};
  return {
    on(name, fn) { handlers[name] = fn; },
    emit(name, ...args) { if (handlers[name]) handlers[name](...args); }
  };
}

function setup() {
  const timers = [];
  const peers = [];
  function Peer(id) {
    const p = Object.assign(emitter(), { id, destroyed: false, disconnected: false, reconnects: 0 });
    p.reconnect = () => { p.reconnects += 1; p.disconnected = false; };
    p.connect = (remote) => Object.assign(emitter(), { peer: remote, open: false, connectionId: "c" + Math.random(), close() {} });
    peers.push(p);
    return p;
  }
  const w = loadScripts(["js/webrtc.js"], { Peer, setTimeout: (fn) => timers.push(fn), clearTimeout() {} });
  return { AppPeer: w.AppPeer, peers, timers };
}

test("合図の線（シグナリング）が切れたら、同じ ID でつなぎなおす", () => {
  const { AppPeer, peers, timers } = setup();
  let told = 0;
  AppPeer.init("me-room", { onPeerDisconnected: () => { told += 1; } });
  const peer = peers[0];
  peer.disconnected = true;
  peer.emit("disconnected");
  timers.forEach((fn) => fn());
  assert.strictEqual(peer.reconnects, 1);
  assert.strictEqual(told, 1);
});

test("古い線が閉じても、今つながっている線は消さない", () => {
  const { AppPeer } = setup();
  AppPeer.init("me-room", {});
  const oldConn = AppPeer.connectTo("other");
  const newConn = AppPeer.connectTo("other");
  newConn.open = true;
  newConn.emit("open");
  oldConn.emit("close");
  assert.strictEqual(AppPeer.isConnected(), true);
});
