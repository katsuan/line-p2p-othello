(function (window) {
  var Game = window.OthelloGame;
  var Quiz = window.OthelloQuiz;
  var QUIZ_RESULT_MS = 900;
  var RECONNECT_TIMEOUT_MS = 8000;
  var RECONNECT_RETRY_MS = 1500;
  var RECONNECT_HANDOFF_TIMEOUT_MS = 1800;
  var REMATCH_RESPONSE_TIMEOUT_MS = 12000;

  function create(app, deps) {
    function stopReconnectTimers() {
      deps.stopTimer("reconnectTimer");
      deps.stopTimer("reconnectRetryTimer");
    }

    function withFallbackTimeout(promise, timeoutMs) {
      return new Promise(function (resolve, reject) {
        var settled = false;
        var timeoutId = window.setTimeout(function () {
          if (settled) {
            return;
          }
          settled = true;
          resolve(false);
        }, timeoutMs);

        promise.then(function (result) {
          if (settled) {
            return;
          }
          settled = true;
          window.clearTimeout(timeoutId);
          resolve(result);
        }).catch(function (error) {
          if (settled) {
            return;
          }
          settled = true;
          window.clearTimeout(timeoutId);
          reject(error);
        });
      });
    }

    function clearResumeState() {
      app.spectatorMode = false;
      app.resumePending = false;
      app.resumeRequesterName = "";
    }

    function clearStartReady() {
      app.localStartReady = false;
      app.remoteStartReady = false;
    }

    function buildStatePayload(type) {
      return {
        type: type || "state",
        board: Game.serializeBoard(app.game.board),
        currentTurn: app.game.currentTurn,
        version: app.game.version,
        winner: app.game.winner,
        message: app.game.message,
        matchConfigured: app.matchConfigured,
        hostColor: app.currentHostColor || app.desiredHostColor,
        rules: app.rules,
        quizAttempts: app.quizAttempts
      };
    }

    // ---- ルール（ホストが決め、相手に送る） ----
    // ホストが変えられるのは、対局を始める前と、対局が終わったあと
    function canEditRules() {
      return app.role === "host" &&
        ((!app.matchConfigured && !app.game.lastMove && !app.game.winner) || !!app.game.winner);
    }

    // 対局が終わったあとにルールを変えたら、相手といっしょに次の対局の準備へ移る
    function moveToNextSetup() {
      if (app.opponentMode !== "com" && AppPeer.isConnected()) {
        try {
          AppPeer.send({ type: "rematch-setup" });
        } catch (error) {
          beginReconnect("ルール変更の送信に失敗しました。 " + error.message);
          return false;
        }
      }
      prepareRematchSetup();
      return true;
    }

    function applyRules(rules) {
      var next = Quiz.normalizeRules(rules);
      var sizeChanged = next.size !== Game.sizeOf(app.game.board);
      app.rules = next;
      if (sizeChanged && !app.matchConfigured) {
        deps.resetGame();
      }
    }

    function changeRules(patch) {
      if (!canEditRules()) {
        deps.setMessage("ルールは、ホストが対局を始める前だけ変えられます。");
        return;
      }
      var next = Object.assign({}, app.rules);
      if (patch.togglePick) {
        next.picks = Quiz.togglePick(app.rules, patch.togglePick);
      } else {
        Object.assign(next, patch);
      }
      if (app.game.winner && !moveToNextSetup()) {
        return;
      }
      applyRules(next);
      clearStartReady();
      sendSetupState();
      if (app.game && !app.game.lastMove) {
        deps.setMessage(app.localTwoPlayer ? "ルールを変えました。START を押してください。" : app.opponentMode === "com" ?
          "ルールを変えました。色を決めて START を押してください。" :
          "ルールを変えました。色を決めて、2人とも START を押してください。");
      }
      deps.render();
    }

    // 開始するたびに問題の種を作り直す（再戦でも別の問題になる）
    // 石を置く色。1台で2人のときは手番の色、それ以外は自分の色
    function actingColor() {
      return app.localTwoPlayer ? app.game.currentTurn : app.myColor;
    }

    function rollQuizSeed() {
      app.rules = Quiz.normalizeRules(Object.assign({}, app.rules, { seed: Quiz.newSeed() }));
    }

    function maybeScheduleComTurn() {
      var moves;
      var bestMove;
      var index;
      var score;

      deps.stopTimer("comTimer");
      if (app.opponentMode !== "com" || app.transportMode !== "com" || app.localTwoPlayer ||
        app.game.winner || !app.matchConfigured || app.resumePending) {
        return;
      }
      if (!app.game.currentTurn || app.game.currentTurn === app.myColor) {
        return;
      }

      moves = Game.getValidMoves(app.game.board, app.game.currentTurn);
      var last = Game.sizeOf(app.game.board) - 1;
      for (index = 0; index < moves.length; index += 1) {
        score = moves[index].flips.length;
        if ((moves[index].row === 0 || moves[index].row === last) && (moves[index].col === 0 || moves[index].col === last)) {
          score += 100;
        } else if (moves[index].row === 0 || moves[index].row === last || moves[index].col === 0 || moves[index].col === last) {
          score += 10;
        }
        if (!bestMove || score > bestMove.score) {
          bestMove = { row: moves[index].row, col: moves[index].col, score: score };
        }
      }

      if (!bestMove) {
        return;
      }

      if (app.rules.mode !== "quiz") {
        app.comTimer = window.setTimeout(function () {
          makeMove(bestMove.row, bestMove.col, app.game.currentTurn, "com", app.game.version + 1);
          deps.render();
        }, 420);
        return;
      }

      // 教養モードの COM は、レベルに応じた確率で問題に正解する。
      // 問題 → COM の答え → 結果 の順に見せてから反映する（相手の回答を見る設定のとき）
      var attempt = app.quizAttempts[quizKey(bestMove.row, bestMove.col)] || 0;
      var question = Quiz.questionFor(app.rules, bestMove.row, bestMove.col, attempt);
      var correct = Math.random() <= Quiz.comAccuracy(question.pick);
      var wrongs = question.choices.map(function (choice, i) { return i; }).filter(function (i) { return i !== question.answer; });
      var watching = {
        row: bestMove.row,
        col: bestMove.col,
        attempt: attempt,
        question: question,
        chosen: null,
        byCom: true
      };
      app.comTimer = window.setTimeout(function () {
        app.opponentQuiz = watching;
        deps.render();
        app.comTimer = window.setTimeout(function () {
          watching.chosen = correct ? question.answer : wrongs[Math.floor(Math.random() * wrongs.length)];
          watching.correct = correct;
          deps.render();
          app.comTimer = window.setTimeout(function () {
            app.opponentQuiz = null;
            if (correct) {
              makeMove(bestMove.row, bestMove.col, app.game.currentTurn, "com", app.game.version + 1);
            } else {
              applyMiss(bestMove.row, bestMove.col, app.game.currentTurn, "com", app.game.version + 1);
            }
            deps.render();
          }, QUIZ_RESULT_MS);
        }, app.watchOpponent ? 1400 : 300);
      }, 300);
    }

    function applyMatchSettings(hostColor, isRematch) {
      app.currentHostColor = hostColor;
      app.desiredHostColor = hostColor;
      app.matchConfigured = true;
      app.myColor = app.role === "host" ? hostColor : Game.getOpponent(hostColor);
      clearResumeState();
      clearStartReady();
      deps.clearRematch();
      deps.resetGame();
      deps.setMessage(isRematch ? "再戦を開始しました。黒が先手です。" : "対局を開始しました。黒が先手です。");
      maybeScheduleComTurn();
    }

    function prepareRematchSetup() {
      var seededColor = app.currentHostColor || app.desiredHostColor || Game.BLACK;

      deps.clearRematch();
      clearResumeState();
      clearStartReady();
      app.currentHostColor = "";
      app.desiredHostColor = seededColor;
      app.matchConfigured = false;
      app.myColor = "";
      app.opponentQuiz = null;
      deps.resetGame();

      if (app.opponentMode === "com") {
        deps.setTransport("ローカル");
        deps.setMode(app.localTwoPlayer ? "1台で 再戦準備" : "COM 再戦準備");
        deps.setOpponentStatus("START 待ち");
        deps.setMessage("再戦の設定を選んで START を押してください。");
        return;
      }

      deps.setMode("再戦準備");
      deps.setOpponentStatus("START 前");
      deps.setMessage("色を決めて、2人とも START を押すと再戦を始めます。");
    }

    function sendSetupState() {
      if (!AppPeer.isConnected() || app.opponentMode !== "human" || app.matchConfigured) {
        return;
      }
      try {
        AppPeer.send({
          type: "setup-sync",
          hostColor: app.desiredHostColor,
          rules: app.role === "host" ? app.rules : null
        });
      } catch (error) {
        beginReconnect("開始前の設定同期に失敗しました。 " + error.message);
      }
    }

    function tryStartHumanMatch() {
      if (!AppPeer.isConnected() || app.opponentMode !== "human" || app.matchConfigured) {
        return;
      }
      if (!app.localStartReady || !app.remoteStartReady) {
        return;
      }
      if (app.role !== "host") {
        deps.setMessage("両者の START が揃いました。相手が開始を確定しています。");
        deps.render();
        return;
      }

      rollQuizSeed();
      applyMatchSettings(app.desiredHostColor, false);
      try {
        AppPeer.send({ type: "start", hostColor: app.desiredHostColor, rules: app.rules });
        sendProfile();
      } catch (error) {
        beginReconnect("開始メッセージの送信に失敗しました。 " + error.message);
      }
    }

    function startMatch() {
      if (app.matchConfigured) {
        return;
      }

      if (app.opponentMode === "com") {
        rollQuizSeed();
        applyMatchSettings(app.desiredHostColor, false);
        return;
      }

      if (!AppPeer.isConnected()) {
        deps.setMessage("相手との接続が完了してから START できます。");
        return;
      }

      try {
        app.localStartReady = true;
        AppPeer.send({ type: "start-ready", hostColor: app.desiredHostColor, rules: app.role === "host" ? app.rules : null });
        deps.setMessage(app.remoteStartReady ?
          "両者の START が揃いました。開始しています。" :
          "あなたは START 準備OKです。相手の START を待っています。");
        tryStartHumanMatch();
      } catch (error) {
        beginReconnect("開始メッセージの送信に失敗しました。 " + error.message);
      }
    }

    function sendStateSnapshot() {
      if (!AppPeer.isConnected() || app.opponentMode === "com") {
        return;
      }
      AppPeer.send(buildStatePayload("state"));
    }

    function sendProfile() {
      if (!AppPeer.isConnected()) {
        return;
      }
      AppPeer.send({
        type: "profile",
        displayName: app.displayName || "LINE ユーザー",
        pictureUrl: app.pictureUrl || ""
      });
    }

    function connectToRemotePeer(peerId) {
      if (!peerId || peerId === app.pendingPeerTarget || AppPeer.isConnected()) {
        return;
      }
      app.pendingPeerTarget = peerId;
      deps.setOpponentStatus("ピアに接続中…");
      AppPeer.connectTo(peerId);
    }

    function scheduleReconnectRetry() {
      deps.stopTimer("reconnectRetryTimer");
      if (!app.reconnecting || AppPeer.isConnected() || !deps.getRemotePeerId()) {
        return;
      }
      app.reconnectRetryTimer = window.setTimeout(function () {
        connectToRemotePeer(deps.getRemotePeerId());
        scheduleReconnectRetry();
      }, RECONNECT_RETRY_MS);
    }

    function switchToCom(reason) {
      app.reconnecting = false;
      app.reconnectReason = "";
      app.reconnectDeadline = 0;
      clearResumeState();
      clearStartReady();
      app.transportMode = "com";
      app.opponentMode = "com";
      deps.stopTimer("p2pTimer");
      stopReconnectTimers();
      deps.stopRoomSubscription();
      deps.clearRematch();
      app.pendingPeerTarget = "";
      deps.setOpponentProfile("COM", "");
      deps.setTransport("ローカル");
      deps.setMode("COM 引き継ぎ");
      deps.setOpponentStatus("切断のため COM に切替");
      deps.setMessage(reason + " 相手の代わりに COM が続けます。");
      maybeScheduleComTurn();
    }

    function beginResumeChoice() {
      clearResumeState();
      clearStartReady();
      app.staleGuest = false;
      deps.stopTimer("comTimer");
      app.resumePending = true;
      app.resumeRequesterName = app.opponentDisplayName || "相手";
      app.pendingPeerTarget = "";
      deps.setTransport("復帰確認");
      deps.setMode("復帰選択");
      deps.setOpponentStatus("復帰しました");
      deps.setMessage((app.resumeRequesterName || "相手") + " が戻りました。再開方法を選んでください。");
      try {
        sendProfile();
        AppPeer.send({
          type: "resume-preview",
          displayName: app.displayName || "LINE ユーザー",
          pictureUrl: app.pictureUrl || "",
          payload: buildStatePayload("resume-preview")
        });
      } catch (error) {
        clearResumeState();
        deps.setTransport("ローカル");
        deps.setMode("COM 引き継ぎ");
        deps.setOpponentStatus("COM 継続中");
        deps.setMessage("復帰した相手への通知に失敗しました。COM を続けます。");
        maybeScheduleComTurn();
        return;
      }
      deps.render();
    }

    function applySharedState(payload) {
      app.currentHostColor = payload.hostColor || app.currentHostColor;
      app.desiredHostColor = payload.hostColor || app.desiredHostColor;
      app.matchConfigured = !!payload.matchConfigured;
      if (payload.hostColor) {
        app.myColor = app.role === "host" ? payload.hostColor : Game.getOpponent(payload.hostColor);
      }
      if (payload.rules) {
        app.rules = Quiz.normalizeRules(payload.rules);
        app.quizAttempts = payload.quizAttempts || {};
      }
      app.quizPrompt = null;
      app.opponentQuiz = null;
      app.game.board = Game.deserializeBoard(payload.board);
      app.game.currentTurn = payload.currentTurn || "";
      app.game.version = Number(payload.version || 0);
      app.game.winner = payload.winner || "";
      app.game.message = payload.message || app.game.message;
      app.resultOverlayDismissed = false;
    }

    function enterSpectatorMode(data) {
      clearResumeState();
      clearStartReady();
      app.spectatorMode = true;
      app.opponentMode = "human";
      app.transportMode = "spectator";
      if (data.displayName || data.pictureUrl) {
        deps.setOpponentProfile(data.displayName || "対戦相手", data.pictureUrl || "");
      }
      applySharedState(data.payload || data);
      deps.setTransport("観戦中");
      deps.setMode("復帰待機");
      deps.setOpponentStatus("選択待ち");
      deps.setMessage("相手が COM で継続中です。今の盤面を表示しています。再開方法の選択を待っています。");
      deps.render();
    }

    function finalizeP2PResume(message) {
      clearResumeState();
      clearStartReady();
      app.reconnecting = false;
      app.reconnectReason = "";
      app.reconnectDeadline = 0;
      app.opponentMode = "human";
      app.transportMode = "p2p";
      deps.stopTimer("p2pTimer");
      stopReconnectTimers();
      deps.stopRoomSubscription();
      deps.setTransport("WebRTC 接続済み");
      deps.setMode("P2P 対戦");
      deps.setOpponentStatus("接続済み");
      deps.setMessage(message);
      deps.render();
    }

    function resumeCurrentGame() {
      if (!app.resumePending || !AppPeer.isConnected()) {
        return;
      }
      clearResumeState();
      clearStartReady();
      app.opponentMode = "human";
      app.transportMode = "p2p";
      deps.setTransport("WebRTC 接続済み");
      deps.setMode("P2P 対戦");
      deps.setOpponentStatus("接続済み");
      deps.setMessage("今の盤面から対局を再開しました。");
      try {
        sendProfile();
        AppPeer.send({
          type: "resume-continue",
          payload: buildStatePayload("resume-continue")
        });
      } catch (error) {
        beginReconnect("対局再開の送信に失敗しました。 " + error.message);
        return;
      }
      deps.render();
    }

    function restartReturnedGame() {
      if (!app.resumePending || !AppPeer.isConnected()) {
        return;
      }
      clearResumeState();
      clearStartReady();
      app.opponentMode = "human";
      try {
        AppPeer.send({
          type: "resume-restart",
          hostColor: app.currentHostColor || app.desiredHostColor || Game.BLACK
        });
      } catch (error) {
        beginReconnect("やり直しの送信に失敗しました。 " + error.message);
        return;
      }
      prepareRematchSetup();
      deps.setMessage("最初からやり直します。色を決めて、2人とも START を押してください。");
      deps.render();
    }

    function handleResumeConnectionLost() {
      if (app.resumePending) {
        clearResumeState();
        deps.setTransport("ローカル");
        deps.setMode("COM 引き継ぎ");
        deps.setOpponentStatus("COM 継続中");
        deps.setMessage("復帰した相手との接続が切れました。COM を続けます。");
        maybeScheduleComTurn();
        deps.render();
        return true;
      }
      if (app.spectatorMode) {
        clearResumeState();
        deps.setTransport("ホスト待機中");
        deps.setMode("マッチング");
        deps.setOpponentStatus("再接続待ち");
        deps.setMessage("相手との接続が切れました。再接続を待っています。");
        deps.render();
        return true;
      }
      return false;
    }

    function beginReconnect(reason) {
      if (app.opponentMode === "com" || !app.roomId || app.reconnecting) {
        return;
      }
      app.reconnecting = true;
      app.reconnectReason = reason;
      app.reconnectDeadline = Date.now() + RECONNECT_TIMEOUT_MS;
      app.transportMode = "reconnecting";
      app.pendingPeerTarget = "";
      clearStartReady();
      deps.stopTimer("p2pTimer");
      stopReconnectTimers();
      deps.setTransport("再接続中");
      deps.setMode("P2P 再接続");
      deps.setOpponentStatus("再接続待ち…");
      deps.setMessage(reason + " 同じルームで再接続を試みます。");
      connectToRemotePeer(deps.getRemotePeerId());
      scheduleReconnectRetry();
      app.reconnectTimer = window.setTimeout(function () {
        var fallbackResult;

        if (AppPeer.isConnected()) {
          return;
        }
        if (!deps.onReconnectTimeout) {
          switchToCom("P2P の再接続に失敗しました。");
          return;
        }

        fallbackResult = deps.onReconnectTimeout("P2P の再接続に失敗しました。");
        if (fallbackResult && typeof fallbackResult.then === "function") {
          withFallbackTimeout(fallbackResult, RECONNECT_HANDOFF_TIMEOUT_MS).then(function (handled) {
            if (!handled && !AppPeer.isConnected()) {
              switchToCom("P2P の再接続に失敗しました。");
            }
          }).catch(function () {
            if (!AppPeer.isConnected()) {
              switchToCom("P2P の再接続に失敗しました。");
            }
          });
          return;
        }

        if (!fallbackResult && !AppPeer.isConnected()) {
          switchToCom("P2P の再接続に失敗しました。");
        }
      }, RECONNECT_TIMEOUT_MS);
      deps.render();
    }

    function retryReconnectNow() {
      if (!app.reconnecting) {
        return;
      }
      app.reconnectDeadline = Date.now() + RECONNECT_TIMEOUT_MS;
      connectToRemotePeer(deps.getRemotePeerId());
      scheduleReconnectRetry();
      deps.setMessage("再接続をもう一度試しています。");
    }

    function startP2PPlay() {
      if (app.transportMode === "com" && app.matchConfigured && !app.game.winner) {
        beginResumeChoice();
        return;
      }

      if (app.matchConfigured && !app.reconnecting && app.transportMode !== "com") {
        clearResumeState();
        clearStartReady();
        deps.stopTimer("p2pTimer");
        deps.stopRoomSubscription();
        deps.setTransport("同期確認中");
        deps.setMode("状態同期");
        deps.setOpponentStatus("盤面を確認中");
        sendProfile();
        deps.render();
        return;
      }

      app.reconnecting = false;
      app.reconnectReason = "";
      app.reconnectDeadline = 0;
      app.staleGuest = false;
      clearResumeState();
      clearStartReady();
      app.opponentMode = "human";
      app.transportMode = "p2p";
      deps.stopTimer("p2pTimer");
      stopReconnectTimers();
      deps.stopRoomSubscription();
      deps.setTransport("WebRTC 接続済み");
      deps.setMode("P2P 対戦");
      deps.setOpponentStatus("接続済み");
      deps.render();

      if (app.role === "host") {
        if (app.matchConfigured) {
          sendStateSnapshot();
          sendProfile();
          deps.setMessage("P2P 接続が再開されました。対局を同期しています。");
        } else {
          sendProfile();
          // つながった時点のルール（教養モード・盤面の大きさなど）を相手にも見せる
          sendSetupState();
          deps.setMessage("P2P 接続が確立されました。色を決めて、2人とも START を押してください。");
        }
        return;
      }

      sendProfile();
      deps.setMessage("P2P 接続が確立されました。色を決めて、2人とも START を押してください。");
    }

    function makeMove(row, col, color, source, version) {
      var expectedVersion = app.game.version + 1;
      var message;

      if (version && version !== expectedVersion) {
        if (source === "remote") {
          switchToCom("ピア間で盤面バージョンの不一致を検出しました。");
        }
        return false;
      }
      if (!Game.applyMove(app.game.board, row, col, color)) {
        if (source === "remote") {
          switchToCom("相手から無効な手が送信されました。");
        }
        return false;
      }

      app.game.version = version || expectedVersion;
      app.game.lastMove = { row: row, col: col, color: color };
      app.opponentQuiz = null;
      message = Game.resolveTurnAfterMove(app.game, color);
      app.game.message = message;
      app.resultOverlayDismissed = false;
      deps.setMessage(message);
      maybeScheduleComTurn();
      return true;
    }

    function sendMove(row, col) {
      var nextVersion = app.game.version + 1;
      var color = actingColor();
      if (!makeMove(row, col, color, "local", nextVersion)) {
        return;
      }
      if (app.transportMode === "p2p") {
        try {
          AppPeer.send({ type: "move", color: color, row: row, col: col, version: nextVersion });
        } catch (error) {
          beginReconnect("P2P 送信に失敗しました。 " + error.message);
        }
      }
    }

    // ---- 教養モード：問題を出し、答えで「置く」か「相手の番」にする ----
    function quizKey(row, col) {
      return row + "-" + col;
    }

    function openQuiz(row, col) {
      var color = actingColor();
      var valid = Game.getMoveMap(Game.getValidMoves(app.game.board, color));
      if (!valid[quizKey(row, col)] || app.quizPrompt) {
        return;
      }
      var attempt = app.quizAttempts[quizKey(row, col)] || 0;
      app.quizPrompt = {
        row: row,
        col: col,
        color: color,
        attempt: attempt,
        question: Quiz.questionFor(app.rules, row, col, attempt),
        chosen: null
      };
      // 相手の画面にも同じ問題を出せるよう、どのマスの何問目かだけ送る（問題は相手側でも同じものが作れる）
      sendQuizProgress({ type: "quiz-open", row: row, col: col, attempt: attempt, version: app.game.version });
      deps.render();
    }

    function sendQuizProgress(message) {
      if (app.transportMode !== "p2p" || !AppPeer.isConnected()) {
        return;
      }
      try {
        AppPeer.send(message);
      } catch (error) {
        // 見せるだけの通知なので、送れなくても対局は続ける
      }
    }

    // 相手が答えている問題（見るだけ）。届いた内容は、いまの盤面で相手が置けるマスのときだけ使う
    function showOpponentQuiz(data) {
      var row = Number(data.row);
      var col = Number(data.col);
      var opponentColor = app.myColor ? Game.getOpponent(app.myColor) : "";
      if (app.rules.mode !== "quiz" || !opponentColor || app.game.currentTurn !== opponentColor ||
        Number(data.version) !== app.game.version ||
        !Game.getMoveMap(Game.getValidMoves(app.game.board, opponentColor))[quizKey(row, col)]) {
        return;
      }
      var attempt = Number(data.attempt) || 0;
      app.opponentQuiz = {
        row: row,
        col: col,
        attempt: attempt,
        question: Quiz.questionFor(app.rules, row, col, attempt),
        chosen: null
      };
    }

    // index = 選んだ選択肢（-1 は「わからない」）。結果を少し見せてから反映する
    function answerQuiz(index) {
      var prompt = app.quizPrompt;
      if (!prompt || prompt.chosen !== null) {
        return;
      }
      prompt.chosen = Number(index);
      prompt.correct = prompt.chosen === prompt.question.answer;
      sendQuizProgress({ type: "quiz-choice", chosen: prompt.chosen });
      deps.render();
      window.setTimeout(function () {
        if (app.quizPrompt !== prompt) {
          return;
        }
        app.quizPrompt = null;
        if (app.game.currentTurn !== prompt.color || app.game.winner) {
          deps.render();
          return;
        }
        if (prompt.correct) {
          sendMove(prompt.row, prompt.col);
        } else {
          sendMiss(prompt.row, prompt.col);
        }
        deps.render();
      }, QUIZ_RESULT_MS);
    }

    // 不正解：石は置かず手番を相手へ。そのマスの次の問題は別のものになる
    function applyMiss(row, col, color, source, version) {
      var expectedVersion = app.game.version + 1;
      if ((version && version !== expectedVersion) || app.game.currentTurn !== color) {
        if (source === "remote") {
          switchToCom("ピア間で盤面バージョンの不一致を検出しました。");
        }
        return false;
      }
      var key = quizKey(row, col);
      app.quizAttempts[key] = (app.quizAttempts[key] || 0) + 1;
      app.game.version = version || expectedVersion;
      app.opponentQuiz = null;
      app.game.message = Game.passTurnAfterMiss(app.game, color);
      deps.setMessage(source === "com" && !app.localTwoPlayer ? "COM は不正解でした。" + app.game.message.replace("不正解でした。", "") : app.game.message);
      maybeScheduleComTurn();
      return true;
    }

    function sendMiss(row, col) {
      var nextVersion = app.game.version + 1;
      var color = actingColor();
      if (!applyMiss(row, col, color, "local", nextVersion)) {
        return;
      }
      if (app.transportMode === "p2p") {
        try {
          AppPeer.send({ type: "miss", color: color, row: row, col: col, version: nextVersion });
        } catch (error) {
          beginReconnect("P2P 送信に失敗しました。 " + error.message);
        }
      }
    }

    function requestRematch() {
      if (app.opponentMode === "com") {
        prepareRematchSetup();
        return;
      }
      if (!AppPeer.isConnected()) {
        return;
      }
      app.rematch.outgoing = true;
      app.rematch.incoming = false;
      app.resultOverlayDismissed = false;
      deps.render();
      try {
        AppPeer.send({ type: "rematch-request" });
        deps.setMessage("再戦リクエストを送信しました。返答を待っています。");
        deps.stopTimer("rematchTimer");
        app.rematchTimer = window.setTimeout(function () {
          if (!app.rematch.outgoing) {
            return;
          }
          app.rematch.outgoing = false;
          deps.setMessage("再戦リクエストに返答がありませんでした。もう一度送るか、この試合を閉じてください。");
          deps.render();
        }, REMATCH_RESPONSE_TIMEOUT_MS);
      } catch (error) {
        deps.stopTimer("rematchTimer");
        app.rematch.outgoing = false;
        beginReconnect("再戦リクエストの送信に失敗しました。 " + error.message);
      }
    }

    function acceptRematch() {
      if (!app.rematch.incoming || !AppPeer.isConnected()) {
        return;
      }
      try {
        AppPeer.send({ type: "rematch-accept" });
      } catch (error) {
        beginReconnect("再戦承認の送信に失敗しました。 " + error.message);
        return;
      }
      app.rematch.incoming = false;
      if (app.role === "host") {
        AppPeer.send({ type: "rematch-setup" });
        prepareRematchSetup();
      } else {
        app.rematch.outgoing = true;
        deps.setMessage("再戦を承認しました。開始前の準備へ戻ります。");
      }
      deps.render();
    }

    function rejectRematch() {
      deps.clearRematch();
      app.resultOverlayDismissed = true;
      deps.render();
      if (AppPeer.isConnected()) {
        try {
          AppPeer.send({ type: "rematch-reject" });
        } catch (error) {
          beginReconnect("再戦辞退の送信に失敗しました。 " + error.message);
        }
      }
      deps.setMessage("この試合を終了しました。続ける場合は新しいルームを作成するか、ページを開き直してください。");
    }

    function handlePeerData(data) {
      if (!data || !data.type) {
        return;
      }
      if (data.type === "move") {
        makeMove(Number(data.row), Number(data.col), data.color, "remote", Number(data.version));
      } else if (data.type === "miss") {
        applyMiss(Number(data.row), Number(data.col), data.color, "remote", Number(data.version));
      } else if (data.type === "start") {
        if (data.rules && app.role !== "host") {
          app.rules = Quiz.normalizeRules(data.rules);
        }
        applyMatchSettings(data.hostColor, false);
      } else if (data.type === "setup-sync") {
        if (data.rules && app.role !== "host") {
          applyRules(data.rules);
        }
        app.desiredHostColor = data.hostColor || app.desiredHostColor;
        clearStartReady();
        deps.setMessage("開始前の設定が更新されました。色を確認して、2人とも START を押してください。");
      } else if (data.type === "start-ready") {
        app.remoteStartReady = true;
        if (data.hostColor) {
          app.desiredHostColor = data.hostColor;
        }
        if (data.rules && app.role !== "host") {
          applyRules(data.rules);
        }
        deps.setMessage(app.localStartReady ?
          "両者の START が揃いました。開始しています。" :
          "相手は START 準備OKです。あなたも START を押してください。");
        tryStartHumanMatch();
      } else if (data.type === "quiz-open") {
        showOpponentQuiz(data);
      } else if (data.type === "quiz-choice") {
        if (app.opponentQuiz && app.opponentQuiz.chosen === null) {
          app.opponentQuiz.chosen = Number(data.chosen);
          app.opponentQuiz.correct = app.opponentQuiz.chosen === app.opponentQuiz.question.answer;
        }
      } else if (data.type === "profile") {
        deps.setOpponentProfile(data.displayName || "対戦相手", data.pictureUrl || "");
      } else if (data.type === "state") {
        applySharedState(data);
        finalizeP2PResume("P2P 接続が再開されました。対局を同期しています。");
      } else if (data.type === "resume-preview") {
        enterSpectatorMode(data);
      } else if (data.type === "resume-continue") {
        applySharedState(data.payload || data);
        finalizeP2PResume("今の盤面から対局を再開しました。");
      } else if (data.type === "resume-restart") {
        clearResumeState();
        clearStartReady();
        app.opponentMode = "human";
        app.currentHostColor = data.hostColor || app.currentHostColor;
        app.desiredHostColor = data.hostColor || app.desiredHostColor;
        prepareRematchSetup();
        deps.setMessage("最初からやり直します。色を決めて、2人とも START を押してください。");
      } else if (data.type === "rematch-request") {
        app.rematch.incoming = true;
        app.rematch.outgoing = false;
        app.resultOverlayDismissed = false;
        deps.setMessage("相手が再戦を希望しています。");
      } else if (data.type === "rematch-accept") {
        if (app.role === "host" && app.rematch.outgoing) {
          AppPeer.send({ type: "rematch-setup" });
          prepareRematchSetup();
        } else {
          deps.setMessage("相手が再戦を承認しました。開始前の準備へ戻ります。");
        }
      } else if (data.type === "rematch-reject") {
        deps.clearRematch();
        app.resultOverlayDismissed = false;
        deps.setMessage("相手は再戦しませんでした。");
      } else if (data.type === "rematch-setup") {
        prepareRematchSetup();
      } else if (data.type === "rematch-start") {
        applyMatchSettings(data.hostColor, true);
      }
      deps.render();
    }

    return {
      applyMatchSettings: applyMatchSettings,
      openQuiz: openQuiz,
      answerQuiz: answerQuiz,
      changeRules: changeRules,
      beginReconnect: beginReconnect,
      connectToRemotePeer: connectToRemotePeer,
      handlePeerData: handlePeerData,
      makeMove: makeMove,
      requestRematch: requestRematch,
      acceptRematch: acceptRematch,
      rejectRematch: rejectRematch,
      resumeCurrentGame: resumeCurrentGame,
      restartReturnedGame: restartReturnedGame,
      retryReconnectNow: retryReconnectNow,
      handleResumeConnectionLost: handleResumeConnectionLost,
      startMatch: startMatch,
      syncSetupState: sendSetupState,
      sendMove: sendMove,
      startP2PPlay: startP2PPlay,
      switchToCom: switchToCom,
      resumeComTurn: maybeScheduleComTurn
    };
  }

  window.OthelloPlay = { create: create };
}(window));
