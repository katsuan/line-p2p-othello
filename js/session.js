// 画面の状態とルーム（OthelloSession）：本人を決め、ルームに入り（ホスト・ゲスト）、相手とつなぎ、ボタンを対局の処理につなぐ。
// この端末に対局の続きを残し、開きなおしたら戻す。app.js が create().bootstrap() で始める。対局の進め方は play.js、描くのは ui.js
(function (window) {
  var Game = window.OthelloGame;
  var Platform = window.OthelloPlatform;
  var Matchmaking = window.OthelloMatchmaking;
  var P2P_TIMEOUT_MS = 5000;
  var LOBBY_ROOM_ID = "lobby";

  // ルームの URL（join なら「参加する」しるしつき）
  function buildPageUrl(roomId, joinRequested) {
    var baseUrl = Platform.getAppBaseUrl();
    var currentParams = new URLSearchParams(window.location.search);
    var nextParams = new URLSearchParams();

    if (currentParams.get("vscode-livepreview") === "true") {
      nextParams.set("vscode-livepreview", "true");
    }

    if (roomId) {
      nextParams.set("room", roomId);
      if (joinRequested) {
        nextParams.set("join", "1");
      }
    }

    return nextParams.toString() ? (baseUrl + "?" + nextParams.toString()) : baseUrl;
  }

  var WATCH_STORAGE_KEY = "othello:watch-opponent";

  // 相手が答える問題を見るか（この端末の設定。はじめは見る）
  function loadWatchOpponent() {
    try {
      return window.localStorage.getItem(WATCH_STORAGE_KEY) !== "0";
    } catch (error) {
      return true;
    }
  }

  // 相手が答える問題を見るかを残す
  function saveWatchOpponent(value) {
    try {
      window.localStorage.setItem(WATCH_STORAGE_KEY, value ? "1" : "0");
    } catch (error) {}
  }

  // 画面の状態のはじめの形
  function createState(ui) {
    return {
      ui: ui,
      userId: "",
      appVersion: window.APP_CONFIG && window.APP_CONFIG.appVersion ? window.APP_CONFIG.appVersion : "",
      displayName: "",
      pictureUrl: "",
      opponentDisplayName: "",
      opponentPictureUrl: "",
      peerId: "",
      roomId: "",
      roomUrl: "",
      joinRequested: false,
      role: "",
      myColor: "",
      opponentMode: "human",
      desiredHostColor: Game.BLACK,
      currentHostColor: "",
      matchConfigured: false,
      transportMode: "matchmaking",
      roomData: null,
      roomUnsubscribe: null,
      pendingPeerTarget: "",
      p2pTimer: null,
      rematchTimer: null,
      reconnectTimer: null,
      reconnectRetryTimer: null,
      reconnectTickTimer: null,
      reconnecting: false,
      reconnectReason: "",
      reconnectDeadline: 0,
      staleGuest: false,
      hostTransferred: false,
      localStartReady: false,
      remoteStartReady: false,
      spectatorMode: false,
      resumePending: false,
      resumeRequesterName: "",
      comTimer: null,
      resultOverlayDismissed: false,
      pausePersistence: false,
      rematch: { outgoing: false, incoming: false },
      game: Game.createFreshGame(),
      // ルール（ふつう / 教養・盤面の大きさ・ジャンル・レベル・問題の種）。ホストが決めて相手に送る
      rules: window.OthelloQuiz.normalizeRules({}),
      // 教養モード：マスごとの不正解の回数（次はそのマスで別の問題になる）と、表示中の問題
      quizAttempts: {},
      // 不正解のあとにマスへ割り当てた問題の位置（盤面で問題が重ならないように）と、残りのライフ
      quizRetries: {},
      quizLives: {},
      quizTimer: null,
      quizPrompt: null,
      // 相手（友だち・COM）が答えている問題。見るだけ。watchOpponent=false なら小さく知らせるだけにする
      opponentQuiz: null,
      watchOpponent: loadWatchOpponent(),
      // 1台で2人：COM の代わりに、同じ端末で黒と白を交代で打つ
      localTwoPlayer: false,
      // 友だちを待つ間の COM 練習（ルームは開いたまま。友だちが来たら始め方を選ぶ）
      practiceWhileWaiting: false,
      spectatorPractice: false,
      status: {
        message: "準備しています…",
        transport: "起動中…",
        opponent: "待機中…",
        mode: "マッチング"
      }
    };
  }

  // 画面の状態とルームの処理を作る。返すもの：{ bootstrap }
  function create() {
    var ui = window.OthelloUI.create(window.document);
    var app = createState(ui);
    var storagePrefix = "liff-p2p-session-";

    // 再接続のあいだだけ、残り時間の表示を少しずつ描きなおす
    function syncReconnectTicker() {
      if (app.reconnecting) {
        if (!app.reconnectTickTimer) {
          app.reconnectTickTimer = window.setInterval(function () {
            ui.render(app);
          }, 250);
        }
        return;
      }

      if (app.reconnectTickTimer) {
        window.clearInterval(app.reconnectTickTimer);
        app.reconnectTickTimer = null;
      }
    }

    // 画面を描き、残り時間の時計をそろえ、この端末に続きを残す（skipPersistence なら残さない）
    function renderView(skipPersistence) {
      ui.render(app);
      syncReconnectTicker();
      if (!skipPersistence && !app.pausePersistence) {
        saveLocalState();
      }
    }

    // 画面を描きなおして、続きを残す
    function render() {
      renderView(false);
    }

    // 読みこみ中の表示を消す
    function finishBoot() {
      if (window.document && window.document.body) {
        window.document.body.classList.remove("boot-loading");
      }
    }

    // 失敗の知らせ：画面にはやさしい言葉だけ出し、くわしい中身はコンソールに残す
    function failed(text, error) {
      if (window.console && error) {
        window.console.warn("[ひっくり] " + text, error);
      }
      return text;
    }

    // 知らせの文を変えて描く
    function setMessage(text) {
      app.status.message = text;
      render();
    }

    // 通信の様子の文を変えて描く
    function setTransport(text) {
      app.status.transport = text;
      render();
    }

    // 相手の様子の文を変えて描く
    function setOpponentStatus(text) {
      app.status.opponent = text;
      render();
    }

    // 遊び方の文を変えて描く
    function setMode(text) {
      app.status.mode = text;
      render();
    }

    // app[key] の時計を止める
    function stopTimer(key) {
      if (app[key]) {
        window.clearTimeout(app[key]);
        app[key] = null;
      }
    }

    // ルームの見張りをやめる
    function stopRoomSubscription() {
      if (app.roomUnsubscribe) {
        app.roomUnsubscribe();
        app.roomUnsubscribe = null;
      }
    }

    // 再戦のお願い・返事待ちを消す
    function clearRematch() {
      stopTimer("rematchTimer");
      app.rematch.outgoing = false;
      app.rematch.incoming = false;
    }

    // 「相手が戻ってきた」ときの状態を消す（play.js）
    function clearResumeState() {
      play.clearResumeState();
    }

    // 2人の START の準備OKを消す（play.js）
    function clearStartReady() {
      play.clearStartReady();
    }

    // はじめのライフ（黒と白）
    function freshLives() {
      var lives = {};
      lives[Game.BLACK] = app.rules.lives || 0;
      lives[Game.WHITE] = app.rules.lives || 0;
      return lives;
    }

    // 盤と問題の記録を新しくする
    function resetGame() {
      app.game = Game.createFreshGame(app.rules.size);
      app.quizAttempts = {};
      app.quizRetries = {};
      app.quizLives = freshLives();
      app.quizPrompt = null;
      app.opponentQuiz = null;
      stopTimer("quizTimer");
      app.resultOverlayDismissed = false;
      render();
    }

    // 相手の名前とアイコンを変える（なければ「参加待ち」）
    function setOpponentProfile(name, pictureUrl) {
      app.opponentDisplayName = name || "参加待ち";
      app.opponentPictureUrl = pictureUrl || "";
      render();
    }

    // 開いているルームを変える（URL も合わせて変える。skipHistory なら URL はそのまま）
    function updateRoomContext(roomId, joinRequested, skipHistory) {
      app.roomId = roomId || "";
      app.joinRequested = !!joinRequested;
      app.roomUrl = roomId ? buildPageUrl(roomId, true) : "";
      if (!skipHistory) {
        window.history.replaceState({}, "", buildPageUrl(roomId, joinRequested));
      }
      render();
    }

    // この端末に続きを残すときのキー（ルームごと）
    function getStorageKey() {
      return storagePrefix + app.roomId;
    }

    // この端末に対局の続きを残す（役わりが決まってから）
    function saveLocalState() {
      var payload;

      // 役割（ホスト/ゲスト）が決まる前に保存すると、前の対局の記録を空の状態で上書きしてしまう
      if (!app.roomId || !app.userId || !app.role) {
        return;
      }

      payload = {
        userId: app.userId,
        role: app.role,
        opponentMode: app.opponentMode,
        localTwoPlayer: app.localTwoPlayer,
        practiceWhileWaiting: app.practiceWhileWaiting,
        desiredHostColor: app.desiredHostColor,
        currentHostColor: app.currentHostColor,
        hostTransferred: app.hostTransferred,
        localStartReady: app.localStartReady,
        remoteStartReady: app.remoteStartReady,
        matchConfigured: app.matchConfigured,
        myColor: app.myColor,
        game: app.game,
        rules: app.rules,
        quizAttempts: app.quizAttempts,
        quizRetries: app.quizRetries,
        quizLives: app.quizLives
      };

      try {
        window.sessionStorage.setItem(getStorageKey(), JSON.stringify(payload));
      } catch (error) {}
    }

    // この端末に残した続きを戻す（同じ人・同じ役わりのときだけ）。戻せたら true
    function restoreLocalState() {
      var raw;
      var saved;

      if (!app.roomId || !app.userId || !app.role) {
        return;
      }

      try {
        raw = window.sessionStorage.getItem(getStorageKey());
        saved = raw ? JSON.parse(raw) : null;
      } catch (error) {
        saved = null;
      }

      if (!saved || saved.userId !== app.userId || saved.role !== app.role) {
        return false;
      }

      app.opponentMode = saved.opponentMode || app.opponentMode;
      app.localTwoPlayer = app.opponentMode === "com" && !!saved.localTwoPlayer;
      app.practiceWhileWaiting = app.opponentMode === "com" && !!saved.practiceWhileWaiting;
      app.desiredHostColor = saved.desiredHostColor || app.desiredHostColor;
      app.currentHostColor = saved.currentHostColor || app.currentHostColor;
      app.hostTransferred = !!saved.hostTransferred;
      app.localStartReady = !!saved.localStartReady;
      app.remoteStartReady = !!saved.remoteStartReady;
      app.matchConfigured = !!saved.matchConfigured;
      app.myColor = saved.myColor || app.myColor;
      clearResumeState();
      if (saved.game && saved.game.board) {
        app.game = saved.game;
      }
      if (saved.rules) {
        app.rules = window.OthelloQuiz.normalizeRules(saved.rules);
        app.quizAttempts = saved.quizAttempts || {};
        app.quizRetries = saved.quizRetries || {};
        app.quizLives = saved.quizLives || freshLives();
      }
      return true;
    }

    // 相手の通信の ID（ルームに書かれたもの）
    function getRemotePeerId() {
      return Matchmaking.getRemotePeerId(app.roomData, app.role);
    }

    // 自分の通信の ID（本人の印とルームから作る）
    function buildPeerId() {
      var userPart = Platform.sanitizeForPeer(app.userId).slice(0, 16);
      var roomPart = Platform.sanitizeForPeer(app.roomId || LOBBY_ROOM_ID).slice(-10);
      return userPart + "-" + roomPart;
    }

    // URL から、開くルーム・参加か・はじめの遊び方（COM・1台で2人）を読む
    function prepareRoomContext() {
      var params = new URLSearchParams(window.location.search);
      // 「COMと練習」から来たときは、ルームを開いたあと COM 対戦を選んだ状態にする（URL からはすぐ消える）
      app.startWithCom = params.get("opponent") === "com" || params.get("opponent") === "local";
      app.startWithLocal = params.get("opponent") === "local";
      // ルーム ID は英数字と - _ だけ（ほかの文字が入った URL は、ルームなしで開く）
      var roomParam = params.get("room") || "";
      updateRoomContext(window.OthelloPeerGuard.isRoomId(roomParam) ? roomParam : "", params.get("join") === "1", true);
    }

    // 今のルームに合わせて URL を書きかえる（ページは開きなおさない）
    function syncBrowserUrl() {
      window.history.replaceState({}, "", buildPageUrl(app.roomId, app.joinRequested));
    }

    // 「再接続」：再接続中ならもう一度試す、そうでなければ同じルームを開きなおす
    function reconnectCurrentRoom() {
      if (!app.roomId) {
        setMessage("先にルームを開いてから再接続してください。");
        return;
      }
      if (app.reconnecting) {
        play.retryReconnectNow();
        return;
      }
      AppPeer.disconnect();
      Platform.reload(buildPageUrl(app.roomId, app.joinRequested), true);
    }

    // 対局のとちゅうか（始めた・1手でも打った・まだ終わっていない）
    function isActiveMatch() {
      return !app.game.winner && (app.matchConfigured || !!app.game.lastMove);
    }

    // 手元のルームの中身を「自分がホストで、相手の席は空き」にする（Firestore に書いたのと同じ形）
    function markRoomWaitingForGuest() {
      app.roomData = app.roomData || {};
      app.roomData.roomId = app.roomId;
      app.roomData.hostUserId = app.userId;
      app.roomData.hostPeerId = app.peerId;
      app.roomData.guestUserId = "";
      app.roomData.guestPeerId = "";
      app.roomData.status = "waiting";
    }

    // 友だちの参加を待つ、対局前のホストに戻す（再接続の待ちも終える）
    function backToWaitingRoom(opponentStatus, message) {
      play.endReconnect();
      app.opponentMode = "human";
      app.transportMode = "matchmaking";
      app.currentHostColor = "";
      clearStartReady();
      app.matchConfigured = false;
      app.myColor = "";
      clearResumeState();
      clearRematch();
      resetGame();
      setOpponentProfile("参加待ち", "");
      setTransport("ゲスト待機中");
      setMode("マッチング");
      setOpponentStatus(opponentStatus);
      setMessage(message);
      subscribeToRoom();
    }

    // ゲストがルームを引き継いだ：自分をホストにする
    function applyPromotedHostRoom() {
      app.role = "host";
      app.joinRequested = false;
      app.hostTransferred = true;
      app.staleGuest = false;
      app.pendingPeerTarget = "";
      markRoomWaitingForGuest();
      syncBrowserUrl();
    }

    // ホストが戻らないとき、ゲストがルームを引き継ぐ（対局中なら COM で続ける）。引き継げたら true
    function promoteCurrentGuestToHost(reason) {
      var activeMatch = isActiveMatch();
      var nextHostColor = app.myColor || app.currentHostColor || app.desiredHostColor || Game.BLACK;

      if (app.role !== "guest" || app.opponentMode === "com" || !app.roomId) {
        return Promise.resolve(false);
      }

      stopRoomSubscription();
      setTransport("ルーム引継ぎ中");
      setMode(activeMatch ? "COM 引継ぎ" : "マッチング");
      setOpponentStatus("ホスト譲渡中");
      setMessage(reason + " このルームを引き継いでいます。");

      return Matchmaking.promoteGuestToHost(app.roomId, app.userId, app.peerId).then(function () {
        applyPromotedHostRoom();
        app.currentHostColor = nextHostColor;
        app.desiredHostColor = nextHostColor;

        if (activeMatch) {
          play.switchToCom(reason + " このルームを引き継ぎました。");
        } else {
          backToWaitingRoom("このルームを引き継ぎました",
            "ホストの復帰待ちは終了しました。このルームを引き継いだので、友だちを待つか COM に切り替えられます。");
          app.currentHostColor = nextHostColor;
        }
        render();
        return true;
      }).catch(function () {
        return false;
      });
    }

    // 相手が戻らないとき、ホストは相手の席を空けて待ちに戻す（対局前だけ）。戻せたら true
    function reopenHostWaitingRoom(reason) {
      if (app.role !== "host" || app.opponentMode === "com" || !app.roomId || isActiveMatch()) {
        return Promise.resolve(false);
      }

      stopRoomSubscription();
      setTransport("待機へ戻しています");
      setMode("マッチング");
      setOpponentStatus("参加待ちへ戻しています");
      setMessage(reason + " 相手の席を開放して待機状態へ戻しています。");

      return Matchmaking.resetHostRoom(app.roomId, app.userId, app.peerId).then(function () {
        markRoomWaitingForGuest();
        app.staleGuest = false;
        app.hostTransferred = false;
        backToWaitingRoom("ゲスト待機中", "相手の復帰待ちは終了しました。新しく参加を待つか、COM に切り替えられます。");
        render();
        return true;
      }).catch(function () {
        return false;
      });
    }

    // 再接続の時間が過ぎた：ゲストは引き継ぐ・ホストは待ちに戻す（どちらも Promise）
    function handleReconnectTimeout(reason) {
      if (app.role === "guest" && app.opponentMode === "human") {
        return promoteCurrentGuestToHost(reason);
      }
      if (app.role === "host" && app.opponentMode === "human") {
        return reopenHostWaitingRoom(reason);
      }
      return false;
    }

    // 友だちが参加したことをホストに知らせる（画面のお知らせ・振動・短い音・タブの題名）
    var titleTimer = null;
    // 友だちが参加したことをホストに知らせる（画面のお知らせ・振動・短い音・タブの題名）
    function notifyJoined(name) {
      var text = "🎉 " + name + "が参加しました！";
      ui.showToast(text);
      try {
        if (window.navigator.vibrate) {
          window.navigator.vibrate([120, 80, 120]);
        }
      } catch (error) {}
      try {
        var AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          var audio = new AudioContext();
          [660, 880].forEach(function (frequency, index) {
            var oscillator = audio.createOscillator();
            var gain = audio.createGain();
            var start = audio.currentTime + index * 0.16;
            oscillator.frequency.value = frequency;
            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.exponentialRampToValueAtTime(0.15, start + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
            oscillator.connect(gain);
            gain.connect(audio.destination);
            oscillator.start(start);
            oscillator.stop(start + 0.15);
          });
        }
      } catch (error) {
        // 一度も画面に触れていないと音は鳴らせないことがある
      }
      // 別のタブ・アプリを見ているときは、題名で気づけるようにする（戻ってきたら元に戻す）
      if (window.document.hidden) {
        var original = window.document.title;
        var flip = false;
        window.clearInterval(titleTimer);
        titleTimer = window.setInterval(function () {
          flip = !flip;
          window.document.title = flip ? "🔔 " + name + "が参加しました" : original;
        }, 1000);
        // このタブに戻ってきたら、題名を元に戻す
        var restore = function () {
          if (!window.document.hidden) {
            window.clearInterval(titleTimer);
            window.document.title = original;
            window.document.removeEventListener("visibilitychange", restore);
          }
        };
        window.document.addEventListener("visibilitychange", restore);
        try {
          if (window.Notification && window.Notification.permission === "granted") {
            new window.Notification("ひっくり", { body: text.replace("🎉 ", ""), icon: "assets/apple-touch-icon.png" });
          }
        } catch (error) {}
      }
    }

    var play = window.OthelloPlay.create(app, {
      clearRematch: clearRematch,
      failed: failed,
      notifyJoined: notifyJoined,
      freshLives: freshLives,
      getRemotePeerId: getRemotePeerId,
      onReconnectTimeout: handleReconnectTimeout,
      render: render,
      resetGame: resetGame,
      setMessage: setMessage,
      setMode: setMode,
      setOpponentProfile: setOpponentProfile,
      setOpponentStatus: setOpponentStatus,
      setTransport: setTransport,
      stopRoomSubscription: stopRoomSubscription,
      stopTimer: stopTimer,
      withSeason: Platform.withSeason
    });

    // ルームを見張り、相手が入った・出たら相手につなぎにいく。
    // COM 対戦では見張らない（友だち待ちの練習中は、参加に気づけるよう見張る）
    function subscribeToRoom() {
      // COM 対戦ではルームを見張らない。ただし友だち待ちの練習中は、参加に気づけるよう見張り続ける
      if (app.roomUnsubscribe || !app.roomId || (app.opponentMode === "com" && !app.practiceWhileWaiting)) {
        return;
      }
      app.roomUnsubscribe = Matchmaking.subscribeRoom(app.roomId, function (roomData) {
        app.roomData = roomData;
        if (!roomData) {
          setOpponentStatus("利用不可");
          setMessage("ルームが見つかりません。");
          return;
        }
        if (app.role === "host" && roomData.guestUserId) {
          setOpponentStatus(app.staleGuest ? "切断済み" : "ゲストが参加しました");
        } else if (app.role === "guest") {
          setOpponentStatus(roomData.hostPeerId ? "ホストからの接続を待っています…" : "ホストの準備待ちです");
        }
        if (getRemotePeerId() && !app.staleGuest) {
          play.connectToRemotePeer(getRemotePeerId());
        }
      }, function (error) {
        setMessage(failed("ルームの様子がわからなくなりました。ページを開きなおすと戻ります。", error));
      });
    }

    // ゲストが待つ時計：決まった時間つながらなければ知らせる
    function startGuestWaitTimer() {
      stopTimer("p2pTimer");
      app.p2pTimer = window.setTimeout(function () {
        if (!AppPeer.isConnected()) {
          setMessage("相手とつながりませんでした。相手が戻るのを待つか、新しい対局を作れます。");
        }
      }, P2P_TIMEOUT_MS);
    }

    // ルームに入る（作る・ホストで戻る・ゲストで入る・戻る・満室・見つからない）
    function handleRoomEntry(roomData) {
      var entry;

      if (!app.roomId) {
        app.roomData = null;
        app.role = "";
        app.opponentMode = "human";
        app.currentHostColor = "";
        app.hostTransferred = false;
        clearStartReady();
        app.matchConfigured = false;
        app.myColor = "";
        clearResumeState();
        clearRematch();
        app.pausePersistence = true;
        resetGame();
        app.pausePersistence = false;
        setTransport("未接続");
        setOpponentStatus("待機中…");
        setMode("ロビー");
        setOpponentProfile("参加待ち", "");
        setMessage("遊び方を選ぶか、「ルームIDで参加」から参加できます。");
        return Promise.resolve();
      }

      entry = Matchmaking.resolveEntry(roomData, app.userId, app.joinRequested, app.legacyUserId);
      app.roomData = roomData;

      if (entry === "missing") {
        setTransport("未接続");
        setOpponentStatus("ルームなし");
        setMessage("指定したルームIDが見つかりません。入力内容を確認してください。");
        return Promise.resolve();
      }
      if (entry === "full") {
        setTransport("満室");
        setOpponentStatus("利用不可");
        setMessage("このルームは、もう2人そろっています。「別のルームに参加 / 新しい対局」から、新しいルームで遊べます。");
        return Promise.resolve();
      }

      app.role = entry === "join-guest" || entry === "resume-guest" ? "guest" : "host";
      app.opponentMode = "human";
      app.currentHostColor = "";
      app.hostTransferred = false;
      clearStartReady();
      app.matchConfigured = false;
      app.myColor = "";
      clearResumeState();
      clearRematch();
      app.pausePersistence = true;
      resetGame();
      app.staleGuest = false;
      app.hadLocalSession = restoreLocalState();
      app.pausePersistence = false;
      render();

      // COM・1台で2人の対局は、この端末だけで続きから遊べる
      if (app.hadLocalSession && app.opponentMode === "com" && app.role === "host") {
        app.transportMode = "com";
        setOpponentProfile(app.localTwoPlayer ? "白の人" : "COM", "");
        setTransport("ローカル");
        setMode(app.localTwoPlayer ? "1台で2人" : (app.practiceWhileWaiting ? "練習中（友だち待ち）" : "COM 対戦"));
        setOpponentStatus(app.matchConfigured ? "対局中" : "START 待ち");
        setMessage(app.matchConfigured && !app.game.winner ? "続きから遊べます。" : "START を押してください。");
        play.resumeComTurn();
        if (app.practiceWhileWaiting) {
          subscribeToRoom();
        }
        render();
        return Promise.resolve();
      }

      if (entry === "resume-host" &&
          !!roomData.guestUserId &&
          !app.hadLocalSession &&
          !app.joinRequested) {
        app.staleGuest = true;
        setOpponentProfile("参加待ち", "");
      }

      if (entry === "create-host") {
        setTransport("ゲスト待機中");
        setOpponentStatus("ゲスト待機中");
        setMode("マッチング");
        setOpponentProfile("参加待ち", "");
        setMessage("ルームを作成しました。友だちを招待して参加を待っています。");
        return Matchmaking.createHostRoom(app.roomId, app.userId, app.peerId).then(function () {
          subscribeToRoom();
        });
      }

      if (entry === "join-guest") {
        setTransport("ホスト待機中");
        setOpponentStatus("ルーム参加中…");
        setMode("マッチング");
        setMessage("ルームに参加しました。ホストが接続を始めるまで待っています。");
        return Matchmaking.joinGuestRoom(app.roomId, app.userId, app.peerId).then(function () {
          subscribeToRoom();
          startGuestWaitTimer();
        });
      }

      setTransport(entry === "resume-host" ? "ゲスト待機中" : "ホスト待機中");
      setOpponentStatus(entry === "resume-host" ?
        (app.staleGuest ? "切断済み" : "ゲスト待機中") :
        "ホストからの接続を待っています…");
      setMode("マッチング");
      setMessage(app.staleGuest ?
        "以前の対戦相手は切断済みです。再接続を待つか、COM に切り替えられます。" :
        "既存のルームに再接続しました。接続状態を確認しています。");
      subscribeToRoom();
      if (getRemotePeerId() && !app.staleGuest) {
        play.connectToRemotePeer(getRemotePeerId());
      } else if (entry === "resume-guest") {
        if (!roomData.hostPeerId && !app.hadLocalSession) {
          play.beginReconnect("ホストが不在です。");
        } else {
          startGuestWaitTimer();
        }
      }
      return Promise.resolve();
    }

    // 遊び方を「友だちと対戦」に戻す（ホスト・つながる前・対局前だけ）
    function selectHumanMode() {
      if (app.role !== "host" || AppPeer.isConnected() || app.game.lastMove || app.game.winner) {
        setMessage("対戦相手の種類は、接続前かつ対局前のみ変更できます。");
        return;
      }
      app.opponentMode = "human";
      app.localTwoPlayer = false;
      app.practiceWhileWaiting = false;
      app.transportMode = "matchmaking";
      clearResumeState();
      clearStartReady();
      app.currentHostColor = "";
      app.matchConfigured = false;
      app.myColor = "";
      clearRematch();
      resetGame();
      setOpponentProfile("参加待ち", "");
      setTransport("ゲスト待機中");
      setMode("マッチング");
      setOpponentStatus("ゲスト待機中");
      setMessage("友だちとの対戦に戻しました。相手の参加を待っています。");
      subscribeToRoom();
    }

    // 遊び方を「COM と練習」か「1台で2人」（local）にする（ホスト・つながる前・対局前だけ）
    function selectComMode(local) {
      if (app.role !== "host" || AppPeer.isConnected() || app.game.lastMove || app.game.winner) {
        setMessage("対戦相手の種類は、接続前かつ対局前のみ変更できます。");
        return;
      }
      app.localTwoPlayer = local === true;
      app.practiceWhileWaiting = false;
      app.opponentMode = "com";
      app.transportMode = "com";
      clearResumeState();
      clearStartReady();
      app.currentHostColor = "";
      app.matchConfigured = false;
      app.myColor = "";
      stopRoomSubscription();
      clearRematch();
      resetGame();
      setOpponentProfile(app.localTwoPlayer ? "白の人" : "COM", "");
      setTransport("ローカル");
      setMode(app.localTwoPlayer ? "1台で2人" : "COM 準備");
      setOpponentStatus("START 待ち");
      if (app.localTwoPlayer) {
        // 1台で2人は、黒（先手）が左のカード・白が右のカード。色の入れ替えはしない
        app.desiredHostColor = Game.BLACK;
        setMessage("1台で2人で遊べます。黒の人から交代で打ちます。START を押してください。");
      } else {
        setMessage("COM と練習できます。色を決めて START を押してください。");
      }
    }

    // ホストの色を変える（相手とつながっていれば相手にも送る）
    function handleHostColorChange(color) {
      var canSyncWithPeer = app.opponentMode === "human" &&
        AppPeer.isConnected() &&
        !app.matchConfigured &&
        !app.game.lastMove &&
        !app.game.winner;

      if (app.role !== "host" && !canSyncWithPeer) {
        setMessage("色は、相手とつながってから始めるまでのあいだに変えられます。");
        return;
      }

      app.desiredHostColor = color;
      clearStartReady();
      render();
      if (canSyncWithPeer) {
        play.syncSetupState();
      }
    }

    // ホストの色を入れかえる（1台で2人では変えない）
    function toggleHostColor() {
      if (app.localTwoPlayer) {
        return;
      }
      handleHostColorChange(app.desiredHostColor === Game.BLACK ? Game.WHITE : Game.BLACK);
    }

    // 新しいルームを開く。opponent：com（COM と練習）・local（1台で2人）。ルームを開いたあとその遊び方を選んだ状態にする
    function openNewRoom(opponent) {
      var url = new URL(buildPageUrl(Platform.generateId("room"), false), window.location.href);
      if (opponent) {
        url.searchParams.set("opponent", opponent);
      }
      window.location.href = url.toString();
    }

    // 相手とつなぐ仕組み（PeerJS）を始めて、知らせを対局の処理につなぐ
    function bootstrapPeer() {
      return AppPeer.init(buildPeerId(), {
        onPeerOpen: function (peerId) { app.peerId = peerId; render(); },
        // 相手から来た線を受けるか（ルームに書かれた相手だけ）
        acceptPeer: function (remotePeerId) {
          var expected = getRemotePeerId();
          return !expected || remotePeerId === expected;
        },
        onIncomingConnection: function () { setOpponentStatus("つないでいます…"); },
        onConnectionOpen: play.startP2PPlay,
        onData: play.handlePeerData,
        onConnectionClose: function () { play.handleLinkLost("相手との接続が切れました。"); },
        onConnectionError: function (error) { play.handleLinkLost(failed("相手との通信がうまくいきませんでした。", error)); },
        // PeerJS のまちがい。つなぎにいった相手がまだいないだけなら知らせずに次の試しを待つ（相手が戻れば、どちらかからつながる）
        onPeerError: function (error) {
          // つなぎにいった相手がいまいないだけなら、知らせずに次の試しを待つ（相手が戻れば、どちらかからつながる）
          if (error && error.type === "peer-unavailable") {
            failed("相手がまだいません。", error);
            play.handlePeerUnavailable();
            return;
          }
          setMessage(failed("つなぐ準備がうまくいきませんでした。電波のよいところで、もう一度ためしてね。", error));
        },
        onPeerDisconnected: function () { play.handleLinkLost("通信が切れました。"); }
      });
    }

    return {
      // 始める：ボタンをつなぎ、版を読み、本人を決め、通信を始めて、ルームに入る
      bootstrap: function () {
        prepareRoomContext();
        ui.bind({
          // 盤のマスを押した：自分の番なら置く（教養モードは問題を出す）
          onBoardClick: function (event) {
            var acting = app.localTwoPlayer ? app.game.currentTurn : app.myColor;
            if (app.myColor && acting && !app.spectatorMode && !app.resumePending && app.game.currentTurn === acting && !app.game.winner) {
              var row = Number(event.currentTarget.getAttribute("data-row"));
              var col = Number(event.currentTarget.getAttribute("data-col"));
              // 教養モードは、置く前に問題に答える
              if (app.rules.mode === "quiz") {
                play.openQuiz(row, col);
              } else {
                play.sendMove(row, col);
              }
            }
          },
          onQuizAnswer: play.answerQuiz,
          onQuizText: play.answerQuizText,
          onQuizGiveUp: function () { play.answerQuiz(-1); },
          onChangeRules: play.changeRules,
          // 入れたルーム ID のルームに参加する（形を確かめる）
          onJoinRoom: function () {
            var roomId = ui.getRoomInput();
            if (!roomId) {
              setMessage("参加したいルームIDを入力してください。");
            } else if (!window.OthelloPeerGuard.isRoomId(roomId)) {
              setMessage("ルームIDは、英数字と「-」「_」だけです。もう一度たしかめてね。");
            } else if (roomId === app.roomId) {
              if (app.reconnecting) {
                setMessage("再接続は上のバナーから行えます。");
              } else {
                setMessage("現在このルームを開いています。別のルームIDを入力してください。");
              }
            } else {
              window.location.href = buildPageUrl(roomId, true);
            }
          },
          // ルーム ID をコピーする（できなければ長押しでコピーする窓）
          onCopyRoomId: function () {
            if (!app.roomId) {
              setMessage("コピーできるルームIDがまだありません。");
              return;
            }
            Platform.copyText(app.roomId).then(function (copied) {
              if (copied) {
                setMessage("ルームIDをコピーしました。");
              } else {
                Platform.showCopyBox("ルームIDを長押ししてコピーしてね", app.roomId);
              }
            });
          },
          onQuickReconnect: reconnectCurrentRoom,
          // 招待をカードで送る
          onShareRoom: function () {
            if (!app.roomUrl) {
              setMessage("先に「👥 友だちと対戦」を押すと、招待できます。");
              return;
            }
            Platform.shareRoom(app.roomId, app.roomUrl).then(function (result) {
              if (result.message) {
                setMessage(result.message);
              }
            });
          },
          onNewRoom: function () { openNewRoom(""); },
          onNewComRoom: function () { openNewRoom("com"); },
          onNewLocalRoom: function () { openNewRoom("local"); },
          // 相手が答える問題を見るかを切りかえる
          onToggleWatch: function () {
            app.watchOpponent = !app.watchOpponent;
            saveWatchOpponent(app.watchOpponent);
            render();
          },
          onRetryReconnect: play.retryReconnectNow,
          // 「最初から開きなおす」：確かめてから、この端末の記録を消して開きなおす
          onHardReload: function () {
            // 記録を消して開きなおす
            var reopen = function () { AppPeer.disconnect(); Platform.reload(buildPageUrl(app.roomId, app.joinRequested), true); };
            // この端末に残した対局の記録を消すので、元に戻せない操作として確かめる
            if (!window.LineShareUI || typeof window.LineShareUI.ask !== "function") {
              reopen();
              return;
            }
            window.LineShareUI.ask({
              title: "最初から開きなおしますか？",
              text: "この端末に残した対局の続きは消えます。",
              ok: "開きなおす",
              danger: true
            }).then(function (ok) {
              if (ok) {
                reopen();
              }
            });
          },
          onStartGame: play.startMatch,
          onResumeContinue: play.resumeCurrentGame,
          onResumeRestart: play.restartReturnedGame,
          onSelectHuman: selectHumanMode,
          onSelectCom: function () { selectComMode(false); },
          onSelectLocal: function () { selectComMode(true); },
          onSwapColors: toggleHostColor,
          // 結果の大きいボタン：再戦のお願いを受ける、またはお願いする
          onResultPrimary: function () {
            if (app.rematch.incoming) {
              play.acceptRematch();
            } else if (!app.rematch.outgoing) {
              play.requestRematch();
            }
          },
          // 結果をカードで送る（送れたら「続けて別のトークにも送る」）
          onShareResult: function () {
            if (!app.game.winner) {
              return;
            }
            var counts = Game.countDiscs(app.game.board);
            var mine = app.myColor === Game.WHITE ? counts.white : counts.black;
            var theirs = app.myColor === Game.WHITE ? counts.black : counts.white;
            var info = {
              outcome: app.myColor ? Game.outcomeForColor(app.game.winner, app.myColor) : "draw",
              myName: app.displayName || "わたし",
              opponentName: app.opponentDisplayName || (app.opponentMode === "com" ? "COM" : "相手"),
              mine: mine,
              theirs: theirs
            };
            // 結果を送る。送れたら true
            var send = function () {
              return Platform.shareResult(info).then(function (result) {
                if (result.message) {
                  setMessage(result.message);
                }
                return result.status === "shared";
              });
            };
            send().then(function (sent) {
              // 送ったあと：続けて別のトークにも送る・閉じる（Q キット）
              if (sent && window.LineShareUI && typeof window.LineShareUI.afterSent === "function") {
                window.LineShareUI.afterSent({ resend: send, title: "結果を送りました" });
              }
            });
          },
          // 結果の小さいボタン：再戦をことわる、または結果を閉じる
          onResultSecondary: function () {
            if (app.rematch.incoming) {
              play.rejectRematch();
            } else {
              app.resultOverlayDismissed = true;
              // 続けかたは、結果を閉じたあとの画面にあるものだけを案内する（ホストは「対局の準備」のルールから次へ）
              setMessage(app.role === "host" ?
                "結果を閉じました。もう一戦するときは、上の「対局の準備」でルールを押すと、次の準備に移ります。" :
                "結果を閉じました。ホストが次の対局を準備すると、ここで続けられます。");
            }
          },
          onResize: render
        });

        render();
        Platform.loadVersionInfo().then(function (version) {
          if (version) {
            app.appVersion = version;
            render();
          }
        });
        Platform.initIdentity().then(function (identity) {
          app.displayName = identity.displayName;
          app.pictureUrl = identity.pictureUrl;
          // ルームには LINE のユーザー ID そのものではなく、そこから作った別の文字を書く
          app.legacyUserId = identity.userId;
          return Platform.hashUserId(identity.userId);
        }).then(function (userKey) {
          app.userId = userKey;
          syncBrowserUrl();
          render();
          Matchmaking.init();
          return bootstrapPeer();
        }).then(function () {
          if (!app.roomId) {
            return handleRoomEntry(null);
          }
          return Matchmaking.fetchRoom(app.roomId).then(handleRoomEntry);
        }).then(function () {
          if (app.startWithCom && app.role === "host") {
            selectComMode(app.startWithLocal);
          }
          app.startWithCom = false;
          app.startWithLocal = false;
          finishBoot();
        }).catch(function (error) {
          finishBoot();
          setTransport("エラー");
          setOpponentStatus("利用不可");
          setMode("停止");
          setMessage(failed("うまく準備できませんでした。電波のよいところで、ページを開きなおしてね。", error));
        });
      }
    };
  }

  window.OthelloSession = { create: create };
}(window));
