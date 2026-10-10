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

  function getMyLabel(app) {
    var label = isCompactMobile() ? "私" : "あなた (You)";
    if (app.myColor) {
      return label + " (" + Game.colorName(app.myColor) + ")";
    }
    return label;
  }

  function getOpponentLabel(app) {
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
    if (isHumanP2PSetup(app)) {
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
    if (app.role) {
      return AppPeer.isConnected() || app.opponentMode === "com" ? "オンライン" : "待機中";
    }
    return "接続前";
  }

  function getOpponentPresenceText(app) {
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
      opponentWon = app.game.winner === opponentColor;
      if (app.game.winner === "draw") {
        return "引き分け";
      }
      return opponentWon ? "勝ちました" : "負けました";
    }
    if (app.matchConfigured && app.myColor && app.game.currentTurn) {
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
        hint: "友だちとはLINEで招待して対戦します。ひとりならCOMとすぐ練習できます。",
        toolsSummary: "ルームIDで参加",
        joinLabel: "参加する",
        newRoomLabel: "新しい対局を作る",
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
            "色を決めて START を押します。"),
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
    if (app.opponentMode === "com") {
      return "COM と続けてもう一戦しますか？";
    }
    return "このルームで続けてもう一戦しますか？";
  }

  function shouldShowStartOverlay(app) {
    if (app.game.winner || app.matchConfigured || app.reconnecting || app.resumePending || app.spectatorMode) {
      return false;
    }
    if (app.opponentMode === "com") {
      return app.role === "host";
    }
    return app.transportMode === "p2p" && (app.role === "host" || app.role === "guest");
  }

  function getStartCaption(app) {
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
      genreChoices: documentRef.getElementById("genreChoices"),
      levelChoices: documentRef.getElementById("levelChoices"),
      ruleSummary: documentRef.getElementById("ruleSummary"),
      ruleBadge: documentRef.getElementById("ruleBadge"),
      quizOverlay: documentRef.getElementById("quizOverlay"),
      quizGenre: documentRef.getElementById("quizGenre"),
      quizText: documentRef.getElementById("quizText"),
      quizChoices: documentRef.getElementById("quizChoices"),
      quizResult: documentRef.getElementById("quizResult"),
      quizGiveUp: documentRef.getElementById("quizGiveUp")
    };
    var boardClickHandler = null;
    var renderedLevelGenre = "";
    var renderedQuizPrompt = null;

    function chip(label, value, attr) {
      return '<button class="button-chip" type="button" ' + attr + '="' + value + '">' + label + "</button>";
    }

    function rulesText(app) {
      var sizeText = app.rules.size + "×" + app.rules.size;
      return app.rules.mode === "quiz" ?
        "📚 教養 " + window.OthelloQuiz.describe(app.rules) + "・" + sizeText :
        "ふつう・" + sizeText;
    }

    return {
      bind: function (handlers) {
        boardClickHandler = handlers.onBoardClick;
        createBoardElements(elements.board, handlers.onBoardClick);
        // ルールの選択肢（盤面・ジャンルは固定、レベルはジャンルに合わせて render で作る）
        elements.sizeChoices.innerHTML = Game.BOARD_SIZES.map(function (size) {
          return chip(size + "×" + size, size, "data-size");
        }).join("");
        elements.genreChoices.innerHTML = window.OthelloQuiz.GENRES.map(function (genre) {
          return chip(genre.icon + " " + genre.label, genre.id, "data-genre");
        }).join("");
        elements.ruleNormalButton.addEventListener("click", function () { handlers.onChangeRules({ mode: "normal" }); });
        elements.ruleQuizButton.addEventListener("click", function () { handlers.onChangeRules({ mode: "quiz" }); });
        elements.sizeChoices.addEventListener("click", function (event) {
          var button = event.target.closest("[data-size]");
          if (button) handlers.onChangeRules({ size: Number(button.getAttribute("data-size")) });
        });
        elements.genreChoices.addEventListener("click", function (event) {
          var button = event.target.closest("[data-genre]");
          if (button) handlers.onChangeRules({ genre: button.getAttribute("data-genre"), level: "" });
        });
        elements.levelChoices.addEventListener("click", function (event) {
          var button = event.target.closest("[data-level]");
          if (button) handlers.onChangeRules({ level: button.getAttribute("data-level") });
        });
        elements.quizChoices.addEventListener("click", function (event) {
          var button = event.target.closest("[data-choice]");
          if (button) handlers.onQuizAnswer(Number(button.getAttribute("data-choice")));
        });
        elements.quizGiveUp.addEventListener("click", handlers.onQuizGiveUp);
        // パネルの transform などが固定表示の基準にならないよう、問題のシートは body の直下に置く
        documentRef.body.appendChild(elements.quizOverlay);
        elements.copyRoomIdButton.addEventListener("click", handlers.onCopyRoomId);
        elements.quickReconnectButton.addEventListener("click", handlers.onQuickReconnect);
        elements.joinRoomButton.addEventListener("click", handlers.onJoinRoom);
        elements.shareButton.addEventListener("click", handlers.onShareRoom);
        elements.newRoomButton.addEventListener("click", handlers.onNewRoom);
        elements.newFriendRoomButton.addEventListener("click", handlers.onNewRoom);
        elements.newComRoomButton.addEventListener("click", handlers.onNewComRoom);
        elements.retryReconnectButton.addEventListener("click", handlers.onRetryReconnect);
        elements.reloadButton.addEventListener("click", handlers.onHardReload);
        elements.resumeContinueButton.addEventListener("click", handlers.onResumeContinue);
        elements.resumeRestartButton.addEventListener("click", handlers.onResumeRestart);
        elements.startButton.addEventListener("click", handlers.onStartGame);
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

      getRoomInput: function () {
        return String(elements.roomInput.value || "").trim();
      },

      setRoomInput: function (roomId) {
        if (documentRef.activeElement !== elements.roomInput) {
          elements.roomInput.value = roomId || "";
        }
      },

      render: function (app) {
        var boardSize = Game.sizeOf(app.game.board);
        if (elements.board.querySelectorAll(".cell").length !== boardSize * boardSize) {
          createBoardElements(elements.board, boardClickHandler, boardSize);
        }
        var buttons = elements.board.querySelectorAll(".cell");
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
        var isMyTurn = !!app.myColor && !!currentTurn && currentTurn === app.myColor;

        if (app.myColor) {
          myCardColor = app.myColor;
          opponentCardColor = Game.getOpponent(app.myColor);
        } else if (app.role === "host") {
          myCardColor = app.desiredHostColor;
          opponentCardColor = Game.getOpponent(app.desiredHostColor);
        }

        this.setRoomInput(app.roomId);
        setText(elements.versionBadge, app.appVersion || "dev");
        setText(elements.roomStateLabel, roomFlow.label);
        setText(elements.roomStateTitle, roomFlow.title);
        setText(elements.roomStateHint, roomFlow.hint);
        setText(elements.roomToolsSummary, roomFlow.toolsSummary);
        setText(elements.joinRoomButton, roomFlow.joinLabel);
        setText(elements.newRoomButton, roomFlow.newRoomLabel);
        setText(elements.roomCurrentId, app.roomId ? ("ルームID: " + app.roomId) : "ルーム未作成");
        setText(elements.myLabel, getMyLabel(app));
        setText(elements.opponentLabel, getOpponentLabel(app));
        setText(elements.myName, app.displayName || "あなた");
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
        setAvatar(elements.myAvatar, app.displayName || "あなた", app.pictureUrl || "");
        setAvatar(elements.opponentAvatar, app.opponentDisplayName || "相手", app.opponentPictureUrl || "");
        setHidden(elements.roomCurrentRow, !roomFlow.showCurrentRoom);
        var isSolo = app.opponentMode === "com";
        setHidden(elements.roomCurrentActions, !app.roomId || isSolo);
        if (elements.quickReconnectButton) {
          elements.quickReconnectButton.disabled = !app.roomId;
          setText(elements.quickReconnectButton, app.reconnecting ? "再試行" : "再接続");
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
        ));
        setHidden(elements.hostSetupOpponentSlot, app.role !== "host" ||
          (app.opponentMode === "human" &&
          !!app.roomData &&
          !!app.roomData.guestUserId &&
          !app.staleGuest));
        elements.humanOpponentButton.classList.toggle("active", app.opponentMode === "human");
        elements.comOpponentButton.classList.toggle("active", app.opponentMode === "com");
        elements.hostColorSwapButton.classList.toggle("is-black-start", app.desiredHostColor === Game.BLACK);
        elements.hostColorSwapButton.classList.toggle("is-white-start", app.desiredHostColor === Game.WHITE);
        elements.hostColorSwapButton.setAttribute("aria-label", app.desiredHostColor === Game.BLACK ?
          "あなたが黒です。押すと白へ切り替えます。" :
          "あなたが白です。押すと黒へ切り替えます。");
        elements.hostColorSwapButton.setAttribute("title", app.desiredHostColor === Game.BLACK ?
          "あなたが黒です。押すと白へ切り替えます。" :
          "あなたが白です。押すと黒へ切り替えます。");
        setText(elements.controlHint, app.opponentMode === "com" ?
          "黒が先手です。COM はこの端末だけで動きます。" :
          (isHumanP2PSetup(app) ?
            "黒が先手です。色を変えると START 準備は解除されます。" :
            "黒が先手です。相手とつながったら 2人で START します。"));

        // ---- ルール ----
        var canEditRules = app.role === "host" && !app.matchConfigured && !app.game.lastMove && !app.game.winner;
        var isQuiz = app.rules.mode === "quiz";
        setHidden(elements.ruleSetup, !canEditRules);
        setHidden(elements.quizRuleRows, !isQuiz);
        elements.ruleNormalButton.classList.toggle("active", !isQuiz);
        elements.ruleQuizButton.classList.toggle("active", isQuiz);
        Array.prototype.forEach.call(elements.sizeChoices.children, function (button) {
          button.classList.toggle("active", Number(button.getAttribute("data-size")) === app.rules.size);
        });
        Array.prototype.forEach.call(elements.genreChoices.children, function (button) {
          button.classList.toggle("active", button.getAttribute("data-genre") === app.rules.genre);
        });
        if (renderedLevelGenre !== app.rules.genre) {
          renderedLevelGenre = app.rules.genre;
          elements.levelChoices.innerHTML = window.OthelloQuiz.findGenre(app.rules.genre).levels.map(function (level) {
            return chip(level.label, level.id, "data-level");
          }).join("");
        }
        Array.prototype.forEach.call(elements.levelChoices.children, function (button) {
          button.classList.toggle("active", button.getAttribute("data-level") === app.rules.level);
        });
        // ゲストはルールを変えられないので、内容だけ見せる
        setHidden(elements.ruleSummary, canEditRules);
        setText(elements.ruleSummary, "ルール：" + rulesText(app) + (app.role === "host" ? "" : "（ホストが決めます）"));
        // 対局中は盤面の上にルールを小さく出す
        setHidden(elements.ruleBadge, !(app.matchConfigured || app.game.lastMove) || (!isQuiz && boardSize === Game.BOARD_SIZE));
        setText(elements.ruleBadge, rulesText(app));

        // ---- 教養モードの問題 ----
        var prompt = app.quizPrompt;
        setHidden(elements.quizOverlay, !prompt);
        if (prompt && prompt !== renderedQuizPrompt) {
          renderedQuizPrompt = prompt;
          setText(elements.quizGenre, window.OthelloQuiz.describe(app.rules) + (prompt.attempt ? "・このマス" + (prompt.attempt + 1) + "問目" : ""));
          setText(elements.quizText, prompt.question.text);
          elements.quizChoices.innerHTML = prompt.question.choices.map(function (choice, index) {
            return '<button class="quiz-choice" type="button" data-choice="' + index + '"></button>';
          }).join("");
          Array.prototype.forEach.call(elements.quizChoices.children, function (button, index) {
            button.textContent = prompt.question.choices[index];
          });
          setText(elements.quizResult, "");
        }
        if (prompt) {
          var answered = prompt.chosen !== null;
          Array.prototype.forEach.call(elements.quizChoices.children, function (button, index) {
            button.disabled = answered;
            button.classList.toggle("is-correct", answered && index === prompt.question.answer);
            button.classList.toggle("is-wrong", answered && index === prompt.chosen && !prompt.correct);
          });
          elements.quizGiveUp.disabled = answered;
          setText(elements.quizResult, answered ? (prompt.correct ? "⭕ 正解！ 石を置きます" : "❌ 不正解… 相手の番です") : "");
          elements.quizResult.className = "quiz-result" + (answered ? (prompt.correct ? " is-correct" : " is-wrong") : "");
        } else {
          renderedQuizPrompt = null;
        }

        setHidden(elements.startOverlay, !shouldShowStartOverlay(app));
        if (shouldShowStartOverlay(app)) {
          setText(elements.startWord, "START");
          setText(elements.startCaption, getStartCaption(app));
          setText(elements.startButton, app.opponentMode === "human" && app.localStartReady ? "準備OK" : "START");
          elements.startButton.disabled = app.opponentMode === "com" ? app.role !== "host" : !!app.localStartReady;
        }

        setHidden(elements.resultOverlay, !app.game.winner || app.resultOverlayDismissed);
        elements.resultOverlay.classList.toggle("visible", !!app.game.winner && !app.resultOverlayDismissed);
        elements.resultOverlay.classList.toggle("result-win", outcome === "win");
        elements.resultOverlay.classList.toggle("result-draw", outcome === "draw");
        elements.resultOverlay.classList.toggle("result-lose", outcome === "lose");
        setText(elements.resultWord, outcome === "draw" ? "DRAW" : (outcome === "win" ? "WIN" : "LOSE"));
        setText(elements.resultCaption, getResultCaption(app));
        setText(elements.resultScoreline, String(app.myColor === Game.BLACK ? counts.black : counts.white) + " - " +
          String(app.myColor === Game.BLACK ? counts.white : counts.black));
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

          if (cellValue) {
            button.className = "cell";
            button.disabled = true;
            button.innerHTML = '<span class="disc ' + (cellValue === Game.BLACK ? "black" : "white") + '"></span>';
          }
        }
      }
    };
  }

  window.OthelloUI = { create: create };
}(window, document));
