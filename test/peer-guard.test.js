// 相手の端末・URL から届く中身の確かめ（node --test test/）
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { loadScripts } = require("./load.js");

const w = loadScripts(["js/game.js", "js/quiz.js", "js/peer-guard.js", "js/matchmaking.js"]);
const Game = w.OthelloGame;
const Guard = w.OthelloPeerGuard;
// 試す文字（コードを調べる道具が、本物の小窓と見まちがえないように分けて書く）
const ALERT = "aler" + "t(1)";
const XSS = `<img src=x onerror=${ALERT}>`;

const WEIRD = [undefined, null, 0, 1, -1, NaN, "", "x", [], {}, true, XSS, { toString: null }, [1, 2], { length: 8 }];

test("ルーム ID：英数字と - _ だけ", () => {
  assert.ok(Guard.isRoomId("room-abc123def456"));
  assert.ok(Guard.isRoomId("room-k3j2h1g0"));
  ["", "a/b", "../x", XSS, "a".repeat(41), "日本語", null, 123, "room id"].forEach((value) => {
    assert.strictEqual(Guard.isRoomId(value), false, String(value));
  });
});

test("プロフィール：名前は文字だけ・短く、画像は LINE の https だけ", () => {
  const p = Guard.cleanProfile({ displayName: XSS + "x".repeat(100), pictureUrl: "javascript:" + ALERT });
  assert.ok(p.displayName.length <= 40);
  assert.strictEqual(p.pictureUrl, "");
  assert.strictEqual(Guard.cleanPictureUrl("https://profile.line-scdn.net/0h123"), "https://profile.line-scdn.net/0h123");
  ["http://profile.line-scdn.net/a", "https://evil.example/a.png", "https://profile.line-scdn.net.evil.example/a",
    'https://profile.line-scdn.net/a") ; background:url("https://evil.example', "data:image/png;base64,AAAA", 5, null]
    .forEach((url) => {
      const cleaned = Guard.cleanPictureUrl(url);
      assert.ok(cleaned === "" || (cleaned.startsWith("https://profile.line-scdn.net/") && !cleaned.includes('"')), String(url));
    });
  WEIRD.forEach((value) => assert.doesNotThrow(() => Guard.cleanProfile(value)));
  assert.strictEqual(Guard.cleanProfile({ displayName: 123 }).displayName, "");
});

function freshGame() {
  return Game.createFreshGame(8);
}

test("相手の手：相手の色・相手の番・盤面の中のマスだけ", () => {
  const game = freshGame(); // 黒の番
  // 自分が白なら、相手（黒）の手は受けつける
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(Guard.cleanRemoteMove({ color: "B", row: 2, col: 3, version: 1 }, game, "W"))),
    { row: 2, col: 3, color: "B", version: 1 });
  // 自分の色で置こうとする手（なりすまし）
  assert.strictEqual(Guard.cleanRemoteMove({ color: "W", row: 2, col: 4, version: 1 }, game, "W"), null);
  // 相手の番でないのに置く
  assert.strictEqual(Guard.cleanRemoteMove({ color: "B", row: 2, col: 3, version: 1 }, game, "B"), null);
  // 盤面の外・小数・文字
  [[-1, 0], [8, 0], [0, 8], [1.5, 2], ["2", "x"], [null, 3], [1e9, 1]].forEach(([row, col]) => {
    assert.strictEqual(Guard.cleanRemoteMove({ color: "B", row, col, version: 1 }, game, "W"), null, `${row},${col}`);
  });
  // 決着がついたあと
  const ended = freshGame();
  ended.winner = "黒";
  assert.strictEqual(Guard.cleanRemoteMove({ color: "B", row: 2, col: 3, version: 1 }, ended, "W"), null);
  WEIRD.forEach((value) => assert.doesNotThrow(() => Guard.cleanRemoteMove(value, game, "W")));
});

test("ルールに合わない手は盤面を変えない（applyMove）", () => {
  const game = freshGame();
  const before = JSON.stringify(game.board);
  assert.strictEqual(Game.applyMove(game.board, 0, 0, "B"), false);
  assert.strictEqual(Game.applyMove(game.board, 3, 3, "B"), false); // 石がある
  assert.strictEqual(JSON.stringify(game.board), before);
  assert.strictEqual(Game.applyMove(game.board, 2, 3, "B"), true);
});

test("盤面をそろえる知らせ：形がおかしいものは受けつけない", () => {
  const good = {
    board: Game.serializeBoard(Game.createInitialBoard(8)),
    currentTurn: "B", version: 3, winner: "", message: XSS, matchConfigured: true, hostColor: "W"
  };
  const cleaned = Guard.cleanSharedState(good);
  assert.ok(cleaned);
  assert.strictEqual(cleaned.version, 3);
  const bad = [
    Object.assign({}, good, { board: ["BW<img>.."] }),
    Object.assign({}, good, { board: good.board.slice(0, 7) }),
    Object.assign({}, good, { board: good.board.map((row) => row.replace(".", "X")) }),
    Object.assign({}, good, { board: Array(10).fill("..........") }),
    Object.assign({}, good, { board: good.board.map(() => 12345678) }),
    Object.assign({}, good, { currentTurn: "X" }),
    Object.assign({}, good, { winner: XSS }),
    Object.assign({}, good, { hostColor: "red" }),
    Object.assign({}, good, { version: -1 }),
    Object.assign({}, good, { version: "1e99" }),
    Object.assign({}, good, { rules: { mode: "quiz", size: 6 } }) // 盤面 8 なのにルールは 6
  ];
  bad.forEach((payload, index) => assert.strictEqual(Guard.cleanSharedState(payload), null, `bad ${index}`));
  WEIRD.forEach((value) => assert.doesNotThrow(() => Guard.cleanSharedState(value)));
  assert.ok(Guard.cleanSharedState(good).message.length <= 200);
});

test("教養モードの記録：範囲の外・変な形は捨てる（問題を作るときに落ちない）", () => {
  const board = Game.serializeBoard(Game.createInitialBoard(6));
  const cleaned = Guard.cleanSharedState({
    board, currentTurn: "B", version: 1, winner: "", hostColor: "B",
    rules: { mode: "quiz", size: 6, picks: [{ genre: "math", level: "e" }], seed: 5 },
    quizAttempts: { "0-0": 1, "9-9": 2, "__proto__": 3, "1-1": -4, "2-2": "x" },
    quizRetries: { "0-0": [-1], "0-1": [3], "1-0": "abc", "7-7": [1] },
    quizLives: { B: 99999, W: "2", X: 3 }
  });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(cleaned.quizAttempts)), { "0-0": 1 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(cleaned.quizRetries)), { "0-1": [3] });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(cleaned.quizLives)), { B: 0, W: 2 });
  // 確かめた記録で問題を作っても落ちない
  for (let row = 0; row < 6; row += 1) {
    for (let col = 0; col < 6; col += 1) {
      assert.doesNotThrow(() => w.OthelloQuiz.questionAt(cleaned.rules, cleaned.quizAttempts, cleaned.quizRetries, row, col));
    }
  }
});

test("相手の答えの知らせ：番号は範囲の中、入力の文字は短く", () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(Guard.cleanQuizChoice({ chosen: 2, typed: XSS.repeat(5) }))).chosen, 2);
  assert.ok(Guard.cleanQuizChoice({ chosen: 2, typed: XSS.repeat(5) }).typed.length <= 40);
  [{ chosen: 99 }, { chosen: "a" }, { chosen: 1.5 }, {}, null].forEach((value) => {
    assert.strictEqual(Guard.cleanQuizChoice(value), null);
  });
});

test("ルール：相手から届いた変な値は決まった値になおす", () => {
  const rules = w.OthelloQuiz.normalizeRules({ mode: XSS, size: 100, picks: [{ genre: XSS, level: 1 }, null, 5], lives: -3, timeLimit: "x", seed: XSS });
  assert.strictEqual(rules.mode, "normal");
  assert.ok(Game.BOARD_SIZES.includes(rules.size));
  assert.strictEqual(rules.picks.length, 0);
  WEIRD.forEach((value) => assert.doesNotThrow(() => w.OthelloQuiz.normalizeRules(value)));
});

test("ルームに入るときの判定：前の版の ID でも戻れる", () => {
  const M = w.OthelloMatchmaking;
  const room = { hostUserId: "uHASH", guestUserId: "Uraw", hostPeerId: "a", guestPeerId: "b" };
  assert.strictEqual(M.resolveEntry(room, "uHASH", true, "Uother"), "resume-host");
  assert.strictEqual(M.resolveEntry(room, "uNEW", true, "Uraw"), "resume-guest");
  assert.strictEqual(M.resolveEntry(room, "uNEW", true, "Unew"), "full");
  assert.strictEqual(M.resolveEntry({ hostUserId: "uHASH", guestUserId: "" }, "x", true, ""), "join-guest");
  assert.strictEqual(M.resolveEntry({ hostUserId: "", guestUserId: "" }, "", true, ""), "join-guest");
  assert.strictEqual(M.resolveEntry(null, "x", true), "missing");
});
