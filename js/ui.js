(function (window, document) {
  var Game = window.OthelloGame;

  function setText(element, value) {
    if (element) {
      element.textContent = value;
    }
  }

  function setHidden(element, shouldHide) {
    if (!element) {
      return;
    }
    if (shouldHide) {
      element.classList.add("hidden");
    } else {
      element.classList.remove("hidden");
    }
  }

  function setAvatar(element, name, pictureUrl) {
    if (!element) {
      return;
    }
    element.style.backgroundImage = pictureUrl ? ('url("' + pictureUrl + '")') : "none";
    element.textContent = pictureUrl ? "" : (name || "?").charAt(0).toUpperCase();
  }

  // 盤面のマスを作る。大きさ（6 / 8）が変わったら作り直す
  function createBoardElements(boardElement, onCellClick, size) {
    var fragment = document.createDocumentFragment();
    var boardSize = size || Game.BOARD_SIZE;
    var row;
    var col;
    var button;

    boardElement.innerHTML = "";
    boardElement.style.setProperty("--board-size", String(boardSize));
    for (row = 0; row < boardSize; row += 1) {
      for (col = 0; col < boardSize; col += 1) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "cell";
        button.setAttribute("data-row", row);
        button.setAttribute("data-col", col);
        button.setAttribute("aria-label", "マス " + row + " 行 " + col + " 列");
        button.addEventListener("click", onCellClick);
        fragment.appendChild(button);
      }
    }
    boardElement.appendChild(fragment);
  }

  function isCompactMobile() {
    return window.innerWidth <= 640;
  }

  function isHumanP2PSetup(app) {
    return app.opponentMode === "human" &&
      app.transportMode === "p2p" &&
      !app.matchConfigured &&
      !app.game.lastMove &&
      !app.game.winner;
  }

  // 1台で2人：カードは「黒の人（先手）」「白の人（後手）」として見せる
  function localName(color) {
    return color === Game.WHITE ? "白の人" : "黒の人";
  }

  function getMyLabel(app) {
    if (app.localTwoPlayer) {
      return "先手 (黒)";
    }
    var label = isCompactMobile() ? "私" : "あなた (You)";
    if (app.myColor) {
      return label + " (" + Game.colorName(app.myColor) + ")";
    }
    return label;
  }

  function getOpponentLabel(app) {
    if (app.localTwoPlayer) {
      return "後手 (白)";
    }
    var label = app.opponentMode === "com" ? "COM" : (isCompactMobile() ? "相手" : "対戦相手");
    if (app.myColor) {
      return label + " (" + Game.colorName(Game.getOpponent(app.myColor)) + ")";
    }
    return label;
  }

  function getOpponentName(app) {
    if (app.staleGuest) {
      return "参加待ち";
    }
    if (app.localTwoPlayer) {
      return localName(Game.WHITE);
    }
    if (app.opponentDisplayName) {
      return app.opponentDisplayName;
    }
    if (app.opponentMode === "com") {
      return "COM";
    }
    if (app.roomData && ((app.role === "host" && app.roomData.guestUserId) || (app.role === "guest" && app.roomData.hostUserId))) {
      return "対戦相手";
    }
    return "参加待ち";
  }

  function getMyStatusText(app) {
    var outcome;
    var isMyTurn;

    if (app.spectatorMode) {
      return "観戦中";
    }
    if (app.resumePending) {
      return "再開方法を選択中";
    }
    if (isHumanP2PSetup(app) || isHostWaiting(app)) {
      return app.localStartReady ? "準備OK" : "START 待ち";
    }
    if (app.opponentMode === "com" && !app.matchConfigured && !app.game.lastMove && !app.game.winner) {
      return "START 待ち";
    }
    if (app.game.winner && app.myColor) {
      outcome = Game.outcomeForColor(app.game.winner, app.myColor);
      if (outcome === "win") {
        return "勝ちました";
      }
      if (outcome === "lose") {
        return "負けました";
      }
      return "引き分け";
    }
    if (app.matchConfigured && app.myColor && app.game.currentTurn) {
      isMyTurn = app.game.currentTurn === app.myColor;
      if (app.localTwoPlayer) {
        return isMyTurn ? "打つ番です" : "待っています";
      }
      return isMyTurn ? "あなたの手番" : "相手の手番";
    }
    return app.role ? "準備中" : "待機中";
  }

  function getMyPresenceText(app) {
    if (app.reconnecting) {
      return "再接続中";
    }
    if (app.spectatorMode) {
      return "観戦中";
    }
    if (app.localTwoPlayer) {
      return "この端末";
    }
    if (app.role) {
      return AppPeer.isConnected() || app.opponentMode === "com" ? "オンライン" : "待機中";
    }
    return "接続前";
  }

  function getOpponentPresenceText(app) {
    if (app.localTwoPlayer) {
      return "この端末";
    }
    if (app.opponentMode === "com") {
      return "COM";
    }
    if (app.resumePending) {
      return "復帰済み";
    }
    if (app.spectatorMode) {
      return "オンライン";
    }
    if (app.reconnecting) {
      return "再接続中";
    }
    if (AppPeer.isConnected()) {
      return "オンライン";
    }
    if (app.staleGuest) {
      return "オフライン";
    }
    if (app.role === "host") {
      if (app.roomData && app.roomData.guestUserId) {
        return "オフライン";
      }
      return "未参加";
    }
    if (app.role === "guest") {
      if (app.roomData && app.roomData.hostPeerId) {
        return "接続待ち";
      }
      if (app.roomData && app.roomData.hostUserId) {
        return "オフライン";
      }
      return "未参加";
    }
    return "未参加";
  }

  function getOpponentStatusText(app) {
    var opponentColor;
    var opponentWon;

    if (app.spectatorMode) {
      return "選択待ち";
    }
    if (app.resumePending) {
      return "返答待ち";
    }
    if (isHumanP2PSetup(app)) {
      return app.remoteStartReady ? "準備OK" : "START 待ち";
    }
    if (app.game.winner && app.myColor) {
      opponentColor = Game.getOpponent(app.myColor);
      opponentWon = Game.outcomeForColor(app.game.winner, opponentColor);
      if (opponentWon === "draw") {
        return "引き分け";
      }
      return opponentWon === "win" ? "勝ちました" : "負けました";
    }
    if (app.matchConfigured && app.myColor && app.game.currentTurn) {
      if (app.localTwoPlayer) {
        return app.game.currentTurn === app.myColor ? "待っています" : "打つ番です";
      }
      if (app.opponentQuiz && app.game.currentTurn !== app.myColor) {
        return "問題に回答中";
      }
      return app.game.currentTurn === app.myColor ? "あなたを待っています" : "手を選んでいます";
    }
    if (app.opponentMode === "com") {
      return "START 待ち";
    }
    if (app.staleGuest) {
      return "切断済み";
    }
    if (app.role === "host") {
      if (app.roomData && app.roomData.guestUserId) {
        return "接続待ち";
      }
      return "参加待ち";
    }
    if (app.role === "guest") {
      return "接続待ち";
    }
    return app.status.opponent;
  }

  function setCardColorClass(element, color) {
    if (!element) {
      return;
    }
    element.classList.remove("color-black");
    element.classList.remove("color-white");
    if (color === Game.BLACK) {
      element.classList.add("color-black");
    } else if (color === Game.WHITE) {
      element.classList.add("color-white");
    }
  }

  function getReconnectText(app) {
    var remainingMs = Math.max(0, app.reconnectDeadline - Date.now());
    var remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
    return app.reconnectReason + " 相手との接続を戻しています。[あと" +
      remainingSeconds + "秒待ち] 戻れなければ COM に切り替わります。";
  }

  function shouldShowMessageBox(app) {
    if (!app.status.message || app.reconnecting) {
      return false;
    }

    if (app.rematch.incoming || app.rematch.outgoing) {
      return true;
    }

    if (/エラー|失敗|満室|見つかりません|コピー|送信|終了|再戦|再接続|復帰|引き継|引継|観戦|置ける場所がありません/.test(app.status.message)) {
      return true;
    }

    if (!app.roomId || app.status.mode === "ロビー" || app.status.mode === "マッチング") {
      return false;
    }

    return false;
  }

  function hasJoinedOpponent(app) {
    return app.opponentMode === "human" &&
      !!app.roomData &&
      !!app.roomData.guestUserId &&
      !app.staleGuest;
  }

  function getRoomFlow(app) {
    var joinedOpponent = hasJoinedOpponent(app);
    var isPlaying = app.matchConfigured || !!app.game.lastMove;

    if (!app.roomId) {
      return {
        label: "はじめる",
        title: "だれと遊びますか？",
        hint: "遊び方を選ぶと、次に盤面とルール（ふつう / 📚 教養）を決めて START します。",
        toolsSummary: "ルームIDで参加",
        joinLabel: "参加する",
        newRoomLabel: "新しい対局を作る",
        showCurrentRoom: false,
        showShare: false,
        actionNote: ""
      };
    }

    if (app.localTwoPlayer) {
      return {
        label: "1台で2人",
        title: isPlaying && !app.game.winner ? "1台で2人で対局中です。" : "1台で2人で遊びます。",
        hint: isPlaying && !app.game.winner ?
          "手番の人が盤面をタップします。終わったら端末を相手に渡します。" :
          "下の「対局の準備」で盤面とルールを選んで START を押します。黒の人から交代で打ちます。",
        toolsSummary: "別のルームに参加 / 新しい対局",
        joinLabel: "別のルームに参加",
        newRoomLabel: "別の対局を作る",
        showCurrentRoom: false,
        showShare: false,
        actionNote: ""
      };
    }

    if (app.opponentMode === "com") {
      return {
        label: app.hostTransferred ? "引継ぎ中" : "ひとりで",
        title: isPlaying && !app.game.winner ? "COM と対局中です。" : "COM と練習します。",
        hint: app.hostTransferred && (app.matchConfigured || app.game.lastMove) && !app.game.winner ?
          "このルームを引き継ぎました。相手が戻ると、今の盤面から再開するか選べます。" :
          (isPlaying && !app.game.winner ?
            "続ける時はこのまま、別の対局に移る時だけ下のメニューを使います。" :
            "下の「対局の準備」で盤面とルールを選んで START を押します。"),
        toolsSummary: "別のルームに参加 / 新しい対局",
        joinLabel: "別のルームに参加",
        newRoomLabel: "別の対局を作る",
        // ひとりで遊ぶときはルームID・招待の欄を出さず、盤面の START を主役にする
        showCurrentRoom: false,
        showShare: false,
        actionNote: ""
      };
    }

    if (app.role === "host" && !joinedOpponent && !isPlaying && !app.game.winner) {
      return {
        label: app.hostTransferred ? "引継ぎ済み" : "招待中",
        title: app.hostTransferred ? "このルームを引き継ぎました。" : "友だちの参加を待っています。",
        hint: app.hostTransferred ?
          "友だちの参加を待つか、COM に切り替えて続けられます。" :
          "LINEで招待を送ると、このルームに参加できます。",
        toolsSummary: "別のルームに参加 / 新しい対局",
        joinLabel: "別のルームに参加",
        newRoomLabel: "別の対局を作る",
        showCurrentRoom: true,
        showShare: true,
        actionNote: ""
      };
    }

    if (app.role === "guest" && !isPlaying && !app.game.winner) {
      return {
        label: "参加中",
        title: AppPeer.isConnected() ? "2人そろいました。" : "相手の接続を待っています。",
        hint: AppPeer.isConnected() ?
          "色を確認して、2人とも START を押します。" :
          "つながると、色を確認して2人とも START を押します。",
        toolsSummary: "別のルームに参加 / 新しい対局",
        joinLabel: "別のルームに参加",
        newRoomLabel: "別の対局を作る",
        showCurrentRoom: true,
        showShare: false,
        actionNote: ""
      };
    }

    if (app.role === "host" && joinedOpponent && !isPlaying && !app.game.winner) {
      return {
        label: "START前",
        title: AppPeer.isConnected() ? "2人そろいました。" : "相手の接続を待っています。",
        hint: AppPeer.isConnected() ?
          "色を確認して、2人とも START を押します。" :
          "つながると、色を確認して2人とも START を押します。",
        toolsSummary: "別のルームに参加 / 新しい対局",
        joinLabel: "別のルームに参加",
        newRoomLabel: "別の対局を作る",
        showCurrentRoom: true,
        showShare: false,
        actionNote: ""
      };
    }

    return {
      label: app.game.winner ? "対局終了" : "対局中",
      title: app.game.winner ?
        "対局が終わりました。" :
        "いま対局中です。",
      hint: app.game.winner ?
        "続ける時は盤面のボタンから再戦を選べます。" :
        "手番と置ける場所は盤面に表示しています。",
      toolsSummary: "別のルームに参加 / 新しい対局",
      joinLabel: "別のルームに参加",
      newRoomLabel: "別の対局を作る",
      showCurrentRoom: true,
      showShare: false,
      actionNote: ""
    };
  }

  function getResultCaption(app) {
    if (app.rematch.incoming) {
      return "相手が再戦を希望しています。続けますか？";
    }
    if (app.rematch.outgoing) {
      return "再戦リクエストを送信しました。返答を待っています。";
    }
    if (app.localTwoPlayer) {
      return "1台でもう一戦しますか？";
    }
    if (app.opponentMode === "com") {
      return "COM と続けてもう一戦しますか？";
    }
    return "このルームで続けてもう一戦しますか？";
  }

  // ホストが友だちの参加を待っている（まだつながっていない）開始前
  function isHostWaiting(app) {
    return app.role === "host" && app.opponentMode === "human" && app.transportMode === "matchmaking" &&
      !AppPeer.isConnected() && !app.matchConfigured && !app.game.lastMove && !app.game.winner && !app.reconnecting;
  }

  function shouldShowStartOverlay(app) {
    if (app.game.winner || app.matchConfigured || app.reconnecting || app.resumePending || app.spectatorMode) {
      return false;
    }
    if (isHostWaiting(app)) {
      return true;
    }
    if (app.opponentMode === "com") {
      return app.role === "host";
    }
    return app.transportMode === "p2p" && (app.role === "host" || app.role === "guest");
  }

  function getStartCaption(app) {
    if (isHostWaiting(app)) {
      return app.localStartReady ?
        "準備OKです。友だちが参加して START を押すと始まります。" :
        "先に START しておくと、参加した友だちが START を押すだけで始まります。";
    }
    if (app.localTwoPlayer) {
      return "黒の人から交代で打ちます。STARTで始めます。";
    }
    if (app.opponentMode === "com") {
      return app.desiredHostColor === Game.BLACK ?
        "あなたが黒で始めます。STARTで練習を始めます。" :
        "COMが黒で始めます。STARTで練習を始めます。";
    }
    return app.desiredHostColor === Game.BLACK ?
      "あなたが黒です。2人とも START を押すと対局が始まります。" :
      "相手が黒です。2人とも START を押すと対局が始まります。";
  }

  function create(documentRef) {
    var elements = {
      board: documentRef.getElementById("board"),
      roomInput: documentRef.getElementById("roomInput"),
      versionBadge: documentRef.getElementById("versionBadge"),
      roomStateLabel: documentRef.getElementById("roomStateLabel"),
      roomStateTitle: documentRef.getElementById("roomStateTitle"),
      roomStateHint: documentRef.getElementById("roomStateHint"),
      roomCurrentRow: documentRef.getElementById("roomCurrentRow"),
      roomCurrentActions: documentRef.getElementById("roomCurrentActions"),
      roomCurrentId: documentRef.getElementById("roomCurrentId"),
      quickReconnectButton: documentRef.getElementById("quickReconnectButton"),
      hostInviteActions: documentRef.getElementById("hostInviteActions"),
      roomActionRow: documentRef.getElementById("roomActionRow"),
      roomActionNote: documentRef.getElementById("roomActionNote"),
      roomTools: documentRef.getElementById("roomTools"),
      roomToolsSummary: documentRef.getElementById("roomToolsSummary"),
      copyRoomIdButton: documentRef.getElementById("copyRoomIdButton"),
      joinRoomButton: documentRef.getElementById("joinRoomButton"),
      shareButton: documentRef.getElementById("shareButton"),
      newRoomButton: documentRef.getElementById("newRoomButton"),
      startChoices: documentRef.getElementById("startChoices"),
      newFriendRoomButton: documentRef.getElementById("newFriendRoomButton"),
      newComRoomButton: documentRef.getElementById("newComRoomButton"),
      newLocalRoomButton: documentRef.getElementById("newLocalRoomButton"),
      hostSetupColorSlot: documentRef.getElementById("hostSetupColorSlot"),
      localOpponentButton: documentRef.getElementById("localOpponentButton"),
      quizWatchHead: documentRef.getElementById("quizWatchHead"),
      quizWatchTitle: documentRef.getElementById("quizWatchTitle"),
      quizWatchHide: documentRef.getElementById("quizWatchHide"),
      quizWatchPill: documentRef.getElementById("quizWatchPill"),
      quizWatchPillText: documentRef.getElementById("quizWatchPillText"),
      myCard: documentRef.getElementById("myCard"),
      opponentCard: documentRef.getElementById("opponentCard"),
      myAvatar: documentRef.getElementById("myAvatar"),
      opponentAvatar: documentRef.getElementById("opponentAvatar"),
      myLabel: documentRef.getElementById("myLabel"),
      opponentLabel: documentRef.getElementById("opponentLabel"),
      myName: documentRef.getElementById("myName"),
      myPresence: documentRef.getElementById("myPresence"),
      opponentName: documentRef.getElementById("opponentName"),
      opponentPresence: documentRef.getElementById("opponentPresence"),
      myStatus: documentRef.getElementById("myStatus"),
      opponentStatus: documentRef.getElementById("opponentStatus"),
      myScore: documentRef.getElementById("myScore"),
      opponentScore: documentRef.getElementById("opponentScore"),
      reconnectNotice: documentRef.getElementById("reconnectNotice"),
      reconnectText: documentRef.getElementById("reconnectText"),
      retryReconnectButton: documentRef.getElementById("retryReconnectButton"),
      reloadButton: documentRef.getElementById("reloadButton"),
      resumeNotice: documentRef.getElementById("resumeNotice"),
      resumeText: documentRef.getElementById("resumeText"),
      resumeActions: documentRef.getElementById("resumeActions"),
      resumeContinueButton: documentRef.getElementById("resumeContinueButton"),
      resumeRestartButton: documentRef.getElementById("resumeRestartButton"),
      startOverlay: documentRef.getElementById("startOverlay"),
      startWord: documentRef.getElementById("startWord"),
      startCaption: documentRef.getElementById("startCaption"),
      startButton: documentRef.getElementById("startButton"),
      setupStartButton: documentRef.getElementById("setupStartButton"),
      hostSetupPanel: documentRef.getElementById("hostSetupPanel"),
      hostSetupOpponentSlot: documentRef.getElementById("hostSetupOpponentSlot"),
      humanOpponentButton: documentRef.getElementById("humanOpponentButton"),
      comOpponentButton: documentRef.getElementById("comOpponentButton"),
      hostColorSwapButton: documentRef.getElementById("hostColorSwapButton"),
      controlHint: documentRef.getElementById("controlHint"),
      messageBox: documentRef.getElementById("messageBox"),
      transportStatus: documentRef.getElementById("transportStatus"),
      modeStatus: documentRef.getElementById("modeStatus"),
      roomSummary: documentRef.getElementById("roomSummary"),
      peerSummary: documentRef.getElementById("peerSummary"),
      resultOverlay: documentRef.getElementById("resultOverlay"),
      resultWord: documentRef.getElementById("resultWord"),
      resultCaption: documentRef.getElementById("resultCaption"),
      resultScoreline: documentRef.getElementById("resultScoreline"),
      resultPrimaryButton: documentRef.getElementById("resultPrimaryButton"),
      resultSecondaryButton: documentRef.getElementById("resultSecondaryButton"),
      ruleSetup: documentRef.getElementById("ruleSetup"),
      ruleNormalButton: documentRef.getElementById("ruleNormalButton"),
      ruleQuizButton: documentRef.getElementById("ruleQuizButton"),
      sizeChoices: documentRef.getElementById("sizeChoices"),
      quizRuleRows: documentRef.getElementById("quizRuleRows"),
      pickRows: documentRef.getElementById("pickRows"),
      rulePostGameNote: documentRef.getElementById("rulePostGameNote"),
      ruleSummary: documentRef.getElementById("ruleSummary"),
      ruleBadge: documentRef.getElementById("ruleBadge"),
      quizOverlay: documentRef.getElementById("quizOverlay"),
      quizGenre: documentRef.getElementById("quizGenre"),
      quizCountdown: documentRef.getElementById("quizCountdown"),
      toast: documentRef.getElementById("toast"),
      lifeChoices: documentRef.getElementById("lifeChoices"),
      timeChoices: documentRef.getElementById("timeChoices"),
      quizText: documentRef.getElementById("quizText"),
      quizChoices: documentRef.getElementById("quizChoices"),
      quizResult: documentRef.getElementById("quizResult"),
      quizGiveUp: documentRef.getElementById("quizGiveUp")
    };
    var boardClickHandler = null;
    var renderedQuizPrompt = null;

    function chip(label, value, attr) {
      return '<button class="button-chip" type="button" ' + attr + '="' + value + '">' + label + "</button>";
    }

    function rulesText(app) {
      var sizeText = app.rules.size + "×" + app.rules.size;
      return app.rules.mode === "quiz" ?
        "📚 教養 " + window.OthelloQuiz.describe(app.rules) + "・" + sizeText +
          "・" + lifeLabel(app.rules.lives) + (app.rules.timeLimit ? "・⏱" + app.rules.timeLimit + "秒" : "") :
        "ふつう・" + sizeText;
    }

    function lifeLabel(lives) {
      return lives ? "❤️" + lives : "ライフなし";
    }

    // カードの名前の横に出すライフ（教養モードの対局中だけ）
    function livesText(app, color) {
      if (app.rules.mode !== "quiz" || !app.rules.lives || !color || !(app.matchConfigured || app.game.winner)) {
        return "";
      }
      var left = (app.quizLives || {})[color] || 0;
      return left ? "❤️".repeat(left) : "🤍";
    }

    function setLabelWithLives(element, label, lives) {
      element.textContent = label;
      if (lives) {
        var span = documentRef.createElement("span");
        span.className = "player-lives";
        span.textContent = lives;
        element.appendChild(span);
      }
    }

    // 回答タイムの残り秒数。表示中の問題に締め切りがあるあいだだけ数える
    var countdownTimer = null;
    function updateCountdown(prompt) {
      var active = !!prompt && !!prompt.deadline && prompt.chosen === null;
      setHidden(elements.quizCountdown, !(prompt && prompt.deadline));
      if (prompt && prompt.deadline) {
        var left = Math.max(0, Math.ceil((prompt.deadline - Date.now()) / 1000));
        setText(elements.quizCountdown, prompt.chosen === null ? "⏱ " + left + "秒" : "⏱");
        elements.quizCountdown.classList.toggle("is-hurry", active && left <= 5);
      }
      if (active && !countdownTimer) {
        countdownTimer = window.setInterval(function () {
          var current = lastApp && (lastApp.quizPrompt || lastApp.opponentQuiz);
          updateCountdown(current);
        }, 250);
      } else if (!active && countdownTimer) {
        window.clearInterval(countdownTimer);
        countdownTimer = null;
      }
    }

    var lastApp = null;
    var toastTimer = null;
    var wasPlaying = null;
    // 数式（KaTeX）を読み込めたら、表示中の問題を数式で組み直す
    function rerenderQuiz() {
      renderedQuizPrompt = null;
      if (lastApp) {
        api.render(lastApp);
      }
    }

    var api = {
      bind: function (handlers) {
        boardClickHandler = handlers.onBoardClick;
        createBoardElements(elements.board, handlers.onBoardClick);
        // ルールの選択肢（盤面・ジャンルは固定、レベルはジャンルに合わせて render で作る）
        elements.sizeChoices.innerHTML = Game.BOARD_SIZES.map(function (size) {
          return chip(size + "×" + size, size, "data-size");
        }).join("");
        elements.pickRows.innerHTML = window.OthelloQuiz.GENRES.map(function (genre) {
          return '<div class="pick-row"><span class="pick-genre">' + genre.icon + " " + genre.label + "</span>" +
            '<div class="control-actions rule-wrap">' +
            genre.levels.map(function (level) { return chip(level.label, genre.id + ":" + level.id, "data-pick"); }).join("") +
            "</div></div>";
        }).join("");
        elements.ruleNormalButton.addEventListener("click", function () { handlers.onChangeRules({ mode: "normal" }); });
        elements.ruleQuizButton.addEventListener("click", function () { handlers.onChangeRules({ mode: "quiz" }); });
        elements.lifeChoices.innerHTML = window.OthelloQuiz.LIFE_CHOICES.map(function (lives) {
          return chip(lives ? "❤️" + lives : "なし", lives, "data-lives");
        }).join("");
        elements.timeChoices.innerHTML = window.OthelloQuiz.TIME_CHOICES.map(function (seconds) {
          return chip(seconds ? seconds + "秒" : "なし", seconds, "data-time");
        }).join("");
        elements.lifeChoices.addEventListener("click", function (event) {
          var button = event.target.closest("[data-lives]");
          if (button) handlers.onChangeRules({ lives: Number(button.getAttribute("data-lives")) });
        });
        elements.timeChoices.addEventListener("click", function (event) {
          var button = event.target.closest("[data-time]");
          if (button) handlers.onChangeRules({ timeLimit: Number(button.getAttribute("data-time")) });
        });
        elements.sizeChoices.addEventListener("click", function (event) {
          var button = event.target.closest("[data-size]");
          if (button) handlers.onChangeRules({ size: Number(button.getAttribute("data-size")) });
        });
        elements.pickRows.addEventListener("click", function (event) {
          var button = event.target.closest("[data-pick]");
          if (button) handlers.onChangeRules({ togglePick: button.getAttribute("data-pick") });
        });
        elements.quizChoices.addEventListener("click", function (event) {
          var button = event.target.closest("[data-choice]");
          if (button) handlers.onQuizAnswer(Number(button.getAttribute("data-choice")));
        });
        elements.quizGiveUp.addEventListener("click", handlers.onQuizGiveUp);
        elements.quizWatchHide.addEventListener("click", handlers.onToggleWatch);
        elements.quizWatchPill.addEventListener("click", handlers.onToggleWatch);
        documentRef.body.appendChild(elements.quizWatchPill);
        // パネルの transform などが固定表示の基準にならないよう、問題のシートは body の直下に置く
        documentRef.body.appendChild(elements.quizOverlay);
        elements.copyRoomIdButton.addEventListener("click", handlers.onCopyRoomId);
        elements.quickReconnectButton.addEventListener("click", handlers.onQuickReconnect);
        elements.joinRoomButton.addEventListener("click", handlers.onJoinRoom);
        elements.shareButton.addEventListener("click", handlers.onShareRoom);
        elements.newRoomButton.addEventListener("click", handlers.onNewRoom);
        elements.newFriendRoomButton.addEventListener("click", handlers.onNewRoom);
        elements.newComRoomButton.addEventListener("click", handlers.onNewComRoom);
        elements.newLocalRoomButton.addEventListener("click", handlers.onNewLocalRoom);
        elements.localOpponentButton.addEventListener("click", handlers.onSelectLocal);
        elements.retryReconnectButton.addEventListener("click", handlers.onRetryReconnect);
        elements.reloadButton.addEventListener("click", handlers.onHardReload);
        elements.resumeContinueButton.addEventListener("click", handlers.onResumeContinue);
        elements.resumeRestartButton.addEventListener("click", handlers.onResumeRestart);
        elements.startButton.addEventListener("click", handlers.onStartGame);
        elements.setupStartButton.addEventListener("click", handlers.onStartGame);
        elements.humanOpponentButton.addEventListener("click", handlers.onSelectHuman);
        elements.comOpponentButton.addEventListener("click", handlers.onSelectCom);
        elements.hostColorSwapButton.addEventListener("click", handlers.onSwapColors);
        elements.resultPrimaryButton.addEventListener("click", handlers.onResultPrimary);
        elements.resultSecondaryButton.addEventListener("click", handlers.onResultSecondary);
        elements.roomInput.addEventListener("keydown", function (event) {
          if (event.key === "Enter") {
            handlers.onJoinRoom();
          }
        });
        window.addEventListener("resize", handlers.onResize);
      },

      showToast: function (text) {
        setText(elements.toast, text);
        setHidden(elements.toast, false);
        elements.toast.classList.remove("is-showing");
        void elements.toast.offsetWidth;
        elements.toast.classList.add("is-showing");
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(function () {
          setHidden(elements.toast, true);
          elements.toast.classList.remove("is-showing");
        }, 4500);
      },

      getRoomInput: function () {
        return String(elements.roomInput.value || "").trim();
      },

      setRoomInput: function (roomId) {
        if (documentRef.activeElement !== elements.roomInput) {
          elements.roomInput.value = roomId || "";
        }
      },

      render: function (app) {
        lastApp = app;
        // 対局が始まった瞬間は、準備の欄が消えて盤面が画面の外に残りやすいので、盤面まで送る
        var playingNow = !!app.matchConfigured;
        if (wasPlaying === false && playingNow && elements.board.scrollIntoView) {
          window.setTimeout(function () {
            elements.board.closest(".board-shell").scrollIntoView({ behavior: "smooth", block: "start" });
          }, 0);
        }
        wasPlaying = playingNow;
        var boardSize = Game.sizeOf(app.game.board);
        if (elements.board.querySelectorAll(".cell").length !== boardSize * boardSize) {
          createBoardElements(elements.board, boardClickHandler, boardSize);
        }
        var buttons = elements.board.querySelectorAll(".cell");
        elements.board.classList.toggle("is-quiz", app.rules.mode === "quiz" && app.matchConfigured);
        elements.board.classList.toggle("is-waiting", isHostWaiting(app));
        var validMoves = Game.getValidMoves(app.game.board, app.game.currentTurn);
        var validMap = Game.getMoveMap(validMoves);
        var counts = Game.countDiscs(app.game.board);
        var row;
        var col;
        var index;
        var button;
        var key;
        var cellValue;
        var canPlay;
        var myCardColor = "";
        var opponentCardColor = "";
        var currentTurn = app.game.currentTurn;
        var outcome = Game.outcomeForColor(app.game.winner, app.myColor || Game.BLACK);
        var roomFlow = getRoomFlow(app);
        var showMessage = shouldShowMessageBox(app);
        var isOpponentTurn = !!app.myColor && !!currentTurn && currentTurn === Game.getOpponent(app.myColor);
        // 1台で2人のときは、どちらの手番でもこの端末で打てる
        var isMyTurn = !!app.myColor && !!currentTurn && (app.localTwoPlayer || currentTurn === app.myColor);

        if (app.myColor) {
          myCardColor = app.myColor;
          opponentCardColor = Game.getOpponent(app.myColor);
        } else if (app.role === "host") {
          myCardColor = app.desiredHostColor;
          opponentCardColor = Game.getOpponent(app.desiredHostColor);
        }

        this.setRoomInput(app.roomId);
        documentRef.body.classList.toggle("is-lobby", !app.roomId);
        documentRef.body.classList.toggle("is-playing", !!app.matchConfigured && !app.game.winner);
        setText(elements.versionBadge, app.appVersion || "dev");
        setText(elements.roomStateLabel, roomFlow.label);
        setText(elements.roomStateTitle, roomFlow.title);
        setText(elements.roomStateHint, roomFlow.hint);
        setText(elements.roomToolsSummary, roomFlow.toolsSummary);
        setText(elements.joinRoomButton, roomFlow.joinLabel);
        setText(elements.newRoomButton, roomFlow.newRoomLabel);
        setText(elements.roomCurrentId, app.roomId ? ("ルームID: " + app.roomId) : "ルーム未作成");
        setLabelWithLives(elements.myLabel, getMyLabel(app), livesText(app, app.myColor || (app.localTwoPlayer ? Game.BLACK : "")));
        setLabelWithLives(elements.opponentLabel, getOpponentLabel(app),
          livesText(app, app.myColor ? Game.getOpponent(app.myColor) : (app.localTwoPlayer ? Game.WHITE : "")));
        setText(elements.myName, app.localTwoPlayer ? localName(Game.BLACK) : (app.displayName || "あなた"));
        setText(elements.opponentName, getOpponentName(app));
        setText(elements.myPresence, getMyPresenceText(app));
        setText(elements.opponentPresence, getOpponentPresenceText(app));
        setText(elements.myStatus, getMyStatusText(app));
        setText(elements.opponentStatus, getOpponentStatusText(app));
        setText(elements.myScore, String(app.myColor ? (app.myColor === Game.BLACK ? counts.black : counts.white) : "-"));
        setText(elements.opponentScore, String(app.myColor ? (app.myColor === Game.BLACK ? counts.white : counts.black) : "-"));
        setHidden(elements.messageBox, !showMessage);
        if (showMessage) {
          setText(elements.messageBox, app.status.message);
        }
        setText(elements.transportStatus, app.status.transport);
        setText(elements.modeStatus, app.status.mode);
        setText(elements.roomSummary, app.roomId ? ("ルーム " + app.roomId) : "まだルームはありません");
        setText(elements.peerSummary, app.peerId ? ("ピアID " + app.peerId) : "シグナリングサーバーに接続中…");
        if (app.localTwoPlayer) {
          setAvatar(elements.myAvatar, "黒", "");
          setAvatar(elements.opponentAvatar, "白", "");
        } else {
          setAvatar(elements.myAvatar, app.displayName || "あなた", app.pictureUrl || "");
          setAvatar(elements.opponentAvatar, app.opponentDisplayName || "相手", app.opponentPictureUrl || "");
        }
        setHidden(elements.roomCurrentRow, !roomFlow.showCurrentRoom);
        var isSolo = app.opponentMode === "com";
        setHidden(elements.roomCurrentActions, !app.roomId || isSolo || (roomFlow.showShare && !app.reconnecting));
        if (elements.quickReconnectButton) {
          elements.quickReconnectButton.disabled = !app.roomId;
          setText(elements.quickReconnectButton, app.reconnecting ? "再試行" : "再接続");
          // 招待して待っている間は再接続の出番がないので隠す
          setHidden(elements.quickReconnectButton, roomFlow.showShare && !app.reconnecting);
        }
        setHidden(elements.copyRoomIdButton, !app.roomId);
        setHidden(elements.roomActionRow, !app.roomId || isSolo);
        setHidden(elements.shareButton, !roomFlow.showShare);
        setHidden(elements.roomActionNote, roomFlow.showShare || !roomFlow.actionNote);
        if (!roomFlow.showShare && roomFlow.actionNote) {
          setText(elements.roomActionNote, roomFlow.actionNote);
        }
        // ルームがないときは「友だちと対戦／COMと練習」を主役にし、折りたたみの「別の対局を作る」は出さない
        setHidden(elements.startChoices, !!app.roomId);
        setHidden(elements.newRoomButton, !app.roomId);
        setCardColorClass(elements.myCard, myCardColor);
        setCardColorClass(elements.opponentCard, opponentCardColor);
        elements.myCard.classList.toggle("active-turn", !!app.myColor && !!currentTurn && currentTurn === app.myColor);
        elements.opponentCard.classList.toggle("active-turn", isOpponentTurn);

        setHidden(elements.reconnectNotice, !app.reconnecting);
        if (app.reconnecting) {
          setText(elements.reconnectText, getReconnectText(app));
        }

        setHidden(elements.resumeNotice, !(app.resumePending || app.spectatorMode));
        setHidden(elements.resumeActions, !app.resumePending);
        if (app.resumePending) {
          setText(elements.resumeText,
            (app.resumeRequesterName || "相手") + " が戻りました。今の盤面から再開するか、最初からやり直すか選んでください。");
        } else if (app.spectatorMode) {
          setText(elements.resumeText, "相手が COM で継続中です。今の盤面を表示しています。再開方法の選択を待っています。");
        }

        setHidden(elements.hostSetupPanel, !(
          app.transportMode !== "reconnecting" &&
          !app.matchConfigured &&
          !app.game.lastMove &&
          !app.game.winner &&
          ((app.role === "host") || isHumanP2PSetup(app))
        ) && !(app.role === "host" && !!app.game.winner));
        setHidden(elements.hostSetupOpponentSlot, app.role !== "host" ||
          (app.opponentMode === "human" &&
          !!app.roomData &&
          !!app.roomData.guestUserId &&
          !app.staleGuest));
        elements.humanOpponentButton.classList.toggle("active", app.opponentMode === "human");
        elements.comOpponentButton.classList.toggle("active", app.opponentMode === "com" && !app.localTwoPlayer);
        elements.localOpponentButton.classList.toggle("active", !!app.localTwoPlayer);
        setHidden(elements.hostSetupColorSlot, !!app.localTwoPlayer);
        elements.hostColorSwapButton.classList.toggle("is-black-start", app.desiredHostColor === Game.BLACK);
        elements.hostColorSwapButton.classList.toggle("is-white-start", app.desiredHostColor === Game.WHITE);
        elements.hostColorSwapButton.setAttribute("aria-label", app.desiredHostColor === Game.BLACK ?
          "あなたが黒です。押すと白へ切り替えます。" :
          "あなたが白です。押すと黒へ切り替えます。");
        elements.hostColorSwapButton.setAttribute("title", app.desiredHostColor === Game.BLACK ?
          "あなたが黒です。押すと白へ切り替えます。" :
          "あなたが白です。押すと黒へ切り替えます。");
        setText(elements.controlHint, app.localTwoPlayer ?
          "黒が先手です。1台を交代で使います。" : app.opponentMode === "com" ?
          "黒が先手です。COM はこの端末だけで動きます。" :
          (isHumanP2PSetup(app) ?
            "黒が先手です。色を変えると START 準備は解除されます。" :
            "黒が先手です。友だちを待つ間に START しておけます。"));

        // ---- ルール ----
        var isPostGame = app.role === "host" && !!app.game.winner;
        var canEditRules = app.role === "host" &&
          ((!app.matchConfigured && !app.game.lastMove && !app.game.winner) || isPostGame);
        var isQuiz = app.rules.mode === "quiz";
        if (isQuiz && app.rules.picks.some(function (pick) { return pick.genre === "math"; })) {
          // 数学を選んだら、問題が出る前に数式の組版を読み込んでおく
          window.OthelloTex.load();
        }
        setHidden(elements.ruleSetup, !canEditRules);
        setHidden(elements.quizRuleRows, !isQuiz);
        elements.ruleNormalButton.classList.toggle("active", !isQuiz);
        elements.ruleQuizButton.classList.toggle("active", isQuiz);
        Array.prototype.forEach.call(elements.lifeChoices.children, function (button) {
          button.classList.toggle("active", Number(button.getAttribute("data-lives")) === app.rules.lives);
        });
        Array.prototype.forEach.call(elements.timeChoices.children, function (button) {
          button.classList.toggle("active", Number(button.getAttribute("data-time")) === app.rules.timeLimit);
        });
        Array.prototype.forEach.call(elements.sizeChoices.children, function (button) {
          button.classList.toggle("active", Number(button.getAttribute("data-size")) === app.rules.size);
        });
        Array.prototype.forEach.call(elements.pickRows.querySelectorAll("[data-pick]"), function (button) {
          button.classList.toggle("active", window.OthelloQuiz.hasPick(app.rules, button.getAttribute("data-pick")));
        });
        // 対局後は、ルールの欄だけを出す（色・対戦相手は次の対局の準備で選ぶ）
        elements.hostSetupPanel.classList.toggle("is-post-game", isPostGame);
        setHidden(elements.rulePostGameNote, !isPostGame);
        setText(elements.rulePostGameNote, app.opponentMode === "com" ?
          "対局が終わりました。ルールを変えると、次の対局の準備に移ります。" :
          "対局が終わりました。ルールを変えると、相手といっしょに次の対局の準備に移ります。");
        // ゲストはルールを変えられないので、内容だけ見せる
        setHidden(elements.ruleSummary, canEditRules);
        setText(elements.ruleSummary, "ルール：" + rulesText(app) + (app.role === "host" ? "" : "（ホストが決めます）"));
        // 対局中は盤面の上にルールを小さく出す
        setHidden(elements.ruleBadge, !(app.matchConfigured || app.game.lastMove) || (!isQuiz && boardSize === Game.BOARD_SIZE));
        setText(elements.ruleBadge, rulesText(app));

        // ---- 教養モードの問題 ----
        // 自分の問題を優先。なければ相手が答えている問題を（見る設定なら）見るだけで出す
        var watching = !app.quizPrompt && !!app.opponentQuiz;
        var prompt = app.quizPrompt || (watching && app.watchOpponent ? app.opponentQuiz : null);
        setHidden(elements.quizOverlay, !prompt);
        elements.quizOverlay.classList.toggle("is-watching", watching);
        setHidden(elements.quizWatchHead, !watching);
        setHidden(elements.quizGiveUp, watching);
        setHidden(elements.quizWatchPill, !(watching && !app.watchOpponent));
        setText(elements.quizWatchTitle, app.opponentQuiz && app.opponentQuiz.byCom ? "🤖 COM が回答中…" : "👀 相手が回答中…");
        setText(elements.quizWatchPillText, app.opponentQuiz && app.opponentQuiz.byCom ? "COM が回答中…" : "相手が回答中…");
        if (prompt && prompt !== renderedQuizPrompt) {
          renderedQuizPrompt = prompt;
          setText(elements.quizGenre, (app.localTwoPlayer && prompt.color ? (prompt.color === Game.BLACK ? "⚫ 黒の人・" : "⚪ 白の人・") : "") +
            prompt.question.pickLabel + (prompt.attempt ? "・このマス" + (prompt.attempt + 1) + "問目" : ""));
          window.OthelloTex.setText(elements.quizText, prompt.question.text, prompt.question.tex, rerenderQuiz);
          elements.quizChoices.innerHTML = prompt.question.choices.map(function (choice, index) {
            return '<button class="quiz-choice" type="button" data-choice="' + index + '"></button>';
          }).join("");
          Array.prototype.forEach.call(elements.quizChoices.children, function (button, index) {
            window.OthelloTex.setChoice(button, prompt.question.choices[index], prompt.question.texChoices);
          });
          setText(elements.quizResult, "");
        }
        if (prompt) {
          var answered = prompt.chosen !== null;
          Array.prototype.forEach.call(elements.quizChoices.children, function (button, index) {
            button.disabled = answered || watching;
            button.classList.toggle("is-correct", answered && index === prompt.question.answer);
            button.classList.toggle("is-wrong", answered && index === prompt.chosen && !prompt.correct);
          });
          elements.quizGiveUp.disabled = answered;
          // 不正解のとき：ライフが残っていればライフが減ってもう一度、なければ相手の番
          var answerColor = prompt.color || (watching ? (app.myColor ? Game.getOpponent(app.myColor) : "") : app.myColor);
          var livesLeft = (app.quizLives || {})[answerColor] || 0;
          var canRetry = !!app.rules.lives && livesLeft > 0;
          var missWord = prompt.chosen === -2 ? "⏰ 時間切れ" : (prompt.chosen === -1 ? "🤷 わからない" : "❌ 不正解");
          var who = prompt.byCom ? "COM" : "相手";
          var resultText = !answered ? "" : prompt.correct ?
            (watching ? "⭕ 正解… " + who + "が石を置きます" : "⭕ 正解！ 石を置きます") :
            missWord + (canRetry ?
              "… " + (watching ? who + "の" : "") + "ライフ −1（のこり " + (livesLeft - 1) + "）" + (watching ? "" : "。もう一度選べます") :
              (watching ? "… あなたの番です" : (app.localTwoPlayer ? "… 交代です" : "… 相手の番です")));
          setText(elements.quizResult, resultText);
          elements.quizResult.className = "quiz-result" + (answered ? (prompt.correct ? " is-correct" : " is-wrong") : "");
        } else {
          renderedQuizPrompt = null;
        }
        updateCountdown(prompt);

        var showStart = shouldShowStartOverlay(app);
        // 準備の欄が出ているときは、その一番下の START を使う（盤面までスクロールしなくてよい）
        var startInSetup = showStart && !elements.hostSetupPanel.classList.contains("hidden");
        setHidden(elements.startOverlay, !showStart);
        setHidden(elements.startButton, startInSetup);
        setHidden(elements.setupStartButton, !startInSetup);
        if (showStart) {
          var rulesReady = window.OthelloQuiz.isReady(app.rules);
          var startLabel = !rulesReady ? (app.role === "host" ? "問題を選ぶと START できます" : "ホストが問題を選んでいます") :
            (app.opponentMode === "human" && app.localStartReady ? "準備OK・相手を待っています" : "▶ START");
          var startDisabled = !rulesReady || (app.opponentMode === "com" ? app.role !== "host" : !!app.localStartReady);
          var waiting = isHostWaiting(app);
          // 友だち待ちのあいだは「待っています」と点のアニメーションを出す
          if (waiting) {
            // 毎回書き直すとアニメーションが最初に戻るので、まだ出していないときだけ入れる
            if (!elements.startWord.querySelector(".waiting-dots")) elements.startWord.innerHTML = '友だちを待っています<span class="waiting-dots" aria-hidden="true"><i></i><i></i><i></i></span>';
          } else {
            setText(elements.startWord, "START");
          }
          elements.startWord.classList.toggle("is-waiting", waiting);
          if (waiting) {
            startLabel = !rulesReady ? startLabel : (app.localStartReady ? "✓ 準備OK（取り消す）" : "▶ 先に START しておく");
            startDisabled = !rulesReady;
          }
          setText(elements.startCaption, getStartCaption(app));
          setText(elements.startButton, startLabel);
          setText(elements.setupStartButton, startLabel);
          elements.startButton.disabled = startDisabled;
          elements.setupStartButton.disabled = startDisabled;
        }

        setHidden(elements.resultOverlay, !app.game.winner || app.resultOverlayDismissed);
        elements.resultOverlay.classList.toggle("visible", !!app.game.winner && !app.resultOverlayDismissed);
        elements.resultOverlay.classList.toggle("result-win", outcome === "win");
        elements.resultOverlay.classList.toggle("result-draw", outcome === "draw");
        elements.resultOverlay.classList.toggle("result-lose", outcome === "lose");
        if (app.localTwoPlayer && app.game.winner) {
          // 1台で2人は勝った色を出す（どちらも「WIN」側の色で見せる）
          elements.resultOverlay.classList.toggle("result-win", outcome !== "draw");
          elements.resultOverlay.classList.toggle("result-lose", false);
        }
        // game.winner は「黒」「白」「引き分け」
        setText(elements.resultWord, app.localTwoPlayer && app.game.winner && outcome !== "draw" ?
          app.game.winner + "の勝ち" :
          (outcome === "draw" ? "DRAW" : (outcome === "win" ? "WIN" : "LOSE")));
        setText(elements.resultCaption, getResultCaption(app));
        var resultLives = app.rules.mode === "quiz" && app.rules.lives && counts.black === counts.white ?
          "（ライフ " + ((app.quizLives || {})[app.myColor === Game.WHITE ? Game.WHITE : Game.BLACK] || 0) + " - " +
          ((app.quizLives || {})[app.myColor === Game.WHITE ? Game.BLACK : Game.WHITE] || 0) + "）" : "";
        setText(elements.resultScoreline, String(app.myColor === Game.BLACK ? counts.black : counts.white) + " - " +
          String(app.myColor === Game.BLACK ? counts.white : counts.black) + resultLives);
        setText(elements.resultPrimaryButton, app.rematch.outgoing ? "送信中" : "はい");
        setText(elements.resultSecondaryButton, app.rematch.outgoing ? "閉じる" : "いいえ");
        elements.resultPrimaryButton.disabled = !!app.rematch.outgoing;

        for (index = 0; index < buttons.length; index += 1) {
          button = buttons[index];
          row = Number(button.getAttribute("data-row"));
          col = Number(button.getAttribute("data-col"));
          key = row + "-" + col;
          cellValue = app.game.board[row][col];
          canPlay = false;

          if (!cellValue && !app.game.winner && !!validMap[key]) {
            button.className = isMyTurn ? "cell valid" : "cell opponent-valid";
          } else {
            button.className = "cell";
          }

          canPlay = !!app.myColor &&
            !app.spectatorMode &&
            !app.resumePending &&
            isMyTurn &&
            !app.game.winner &&
            !!validMap[key];

          button.disabled = !canPlay;
          button.innerHTML = "";

          // 教養モードの対局中は、空いているマスにそのマスの問題の1文字を出す
          if (!cellValue && app.rules.mode === "quiz" && app.matchConfigured) {
            var mark = documentRef.createElement("span");
            mark.className = "cell-mark";
            // 4隅は取り合いになる大事なマスなので、問題の手がかりを出さず「？」にする
            var isCorner = (row === 0 || row === boardSize - 1) && (col === 0 || col === boardSize - 1);
            mark.textContent = isCorner ? "？" :
              (window.OthelloQuiz.questionAt(app.rules, app.quizAttempts, app.quizRetries, row, col).mark || "");
            button.appendChild(mark);
          }

          if (cellValue) {
            button.className = "cell";
            button.disabled = true;
            button.innerHTML = '<span class="disc ' + (cellValue === Game.BLACK ? "black" : "white") + '"></span>';
          }
        }
      }
    };
    return api;
  }

  window.OthelloUI = { create: create };
}(window, document));
