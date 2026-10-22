(function (window) {
  var Game = window.OthelloGame;
  var Quiz = window.OthelloQuiz;
  var Guard = window.OthelloPeerGuard;
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
        quizAttempts: app.quizAttempts,
        quizRetries: app.quizRetries,
        quizLives: app.quizLives
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
          beginReconnect(deps.failed("ルールの変更を相手に届けられませんでした。", error));
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
    var TIME_UP = -2;
    var TYPED_WRONG = -3;

    // 入力で答える問題か（設定が「入力」で、その問題が入力に向いているとき）
    function isInputQuestion(question) {
      return app.rules.answerMode === "input" && !!question.canInput;
    }

    function currentQuestion(row, col) {
      return Quiz.questionAt(app.rules, app.quizAttempts, app.quizRetries, row, col);
    }

    // 教養モードで石の数が同じなら、ライフが多く残っているほうの勝ち
    function applyLifeTiebreak() {
      if (app.game.winner !== "引き分け" || app.rules.mode !== "quiz" || !app.rules.lives) {
        return false;
      }
      var black = app.quizLives[Game.BLACK] || 0;
      var white = app.quizLives[Game.WHITE] || 0;
      if (black === white) {
        return false;
      }
      app.game.winner = black > white ? Game.colorName(Game.BLACK) : Game.colorName(Game.WHITE);
      app.game.message = "ゲーム終了。石の数は同じですが、ライフが多い" + app.game.winner + "の勝ちです（ライフ " + black + "対" + white + "）。";
      return true;
    }

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
      var question = currentQuestion(bestMove.row, bestMove.col);
      var correct = Math.random() <= Quiz.comAccuracy(question.pick);
      var wrongs = question.choices.map(function (choice, i) { return i; }).filter(function (i) { return i !== question.answer; });
      var watching = {
        row: bestMove.row,
        col: bestMove.col,
        attempt: attempt,
        question: question,
        chosen: null,
        byCom: true,
        inputMode: isInputQuestion(question)
      };
      app.comTimer = window.setTimeout(function () {
        app.opponentQuiz = watching;
        deps.render();
        app.comTimer = window.setTimeout(function () {
          watching.chosen = correct ? question.answer : wrongs[Math.floor(Math.random() * wrongs.length)];
          watching.correct = correct;
          // 入力形式のときは、COM も選んだ答えを「入力した」ように見せる
          watching.typed = watching.inputMode ? String(question.choices[watching.chosen]) : "";
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
        beginReconnect(deps.failed("準備の内容を相手に届けられませんでした。", error));
      }
    }

    function tryStartHumanMatch() {
      if (!AppPeer.isConnected() || app.opponentMode !== "human" || app.matchConfigured) {
        return;
      }
      if (!app.localStartReady || !app.remoteStartReady || !Quiz.isReady(app.rules)) {
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
        beginReconnect(deps.failed("START を相手に届けられませんでした。", error));
      }
    }

    function startMatch() {
      if (app.matchConfigured) {
        return;
      }
      if (!Quiz.isReady(app.rules)) {
        deps.setMessage("📚 教養モードは、問題を1つ以上選んでから START してください。");
        deps.render();
        return;
      }

      if (app.opponentMode === "com") {
        rollQuizSeed();
        applyMatchSettings(app.desiredHostColor, false);
        return;
      }

      if (!AppPeer.isConnected()) {
        // ホストは友だちを待つ間、このルームのまま COM と練習できる（参加したら知らせて、始め方を選ぶ）
        if (app.role === "host" && app.opponentMode === "human") {
          startPracticeWhileWaiting();
          return;
        }
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
        beginReconnect(deps.failed("START を相手に届けられませんでした。", error));
      }
    }

    function startPracticeWhileWaiting() {
      app.practiceWhileWaiting = true;
      app.opponentMode = "com";
      app.transportMode = "com";
      clearStartReady();
      deps.setOpponentProfile("COM", "");
      deps.setTransport("ローカル");
      deps.setMode("練習中（友だち待ち）");
      deps.setOpponentStatus("COM");
      rollQuizSeed();
      applyMatchSettings(app.desiredHostColor, false);
      deps.setMessage("友だちを待つ間、COM と練習します。友だちが参加したらお知らせします。");
      deps.render();
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
      deps.setOpponentStatus("つないでいます…");
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
      var practice = !!app.practiceWhileWaiting;
      app.resumeRequesterName = practice ? "友だち" : (app.opponentDisplayName || "相手");
      app.pendingPeerTarget = "";
      deps.setTransport(practice ? "友だちが参加" : "復帰確認");
      deps.setMode(practice ? "始め方を選択" : "復帰選択");
      deps.setOpponentStatus(practice ? "参加しました" : "復帰しました");
      deps.setMessage(practice ?
        "友だちが参加しました。最初から対戦するか、今の盤面を友だちと続けるか選んでください。" :
        (app.resumeRequesterName || "相手") + " が戻りました。再開方法を選んでください。");
      if (practice && deps.notifyJoined) {
        deps.notifyJoined("友だち");
      }
      try {
        sendProfile();
        AppPeer.send({
          type: "resume-preview",
          practice: practice,
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
        app.quizRetries = payload.quizRetries || {};
        app.quizLives = payload.quizLives || deps.freshLives();
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

    // state：相手から届いて Guard で確かめた盤面
    function enterSpectatorMode(data, state) {
      clearResumeState();
      clearStartReady();
      app.spectatorMode = true;
      app.spectatorPractice = !!data.practice;
      app.opponentMode = "human";
      app.transportMode = "spectator";
      var profile = Guard.cleanProfile(data);
      if (profile.displayName || profile.pictureUrl) {
        deps.setOpponentProfile(profile.displayName || "対戦相手", profile.pictureUrl);
      }
      applySharedState(state);
      deps.setTransport("観戦中");
      deps.setMode("復帰待機");
      deps.setOpponentStatus("選択待ち");
      deps.setMessage(app.spectatorPractice ?
        "ホストが COM と練習中です。始め方を選ぶまで、今の盤面を見て待っています。" :
        "相手が COM で継続中です。今の盤面を表示しています。再開方法の選択を待っています。");
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
      app.practiceWhileWaiting = false;
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
        beginReconnect(deps.failed("再開を相手に届けられませんでした。", error));
        return;
      }
      deps.render();
    }

    function restartReturnedGame() {
      if (!app.resumePending || !AppPeer.isConnected()) {
        return;
      }
      app.practiceWhileWaiting = false;
      clearResumeState();
      clearStartReady();
      app.opponentMode = "human";
      // ここからは友だちとの通信対戦（COM のままだと手が相手に送られない）
      app.transportMode = "p2p";
      deps.setTransport("WebRTC 接続済み");
      deps.setOpponentStatus("接続済み");
      try {
        AppPeer.send({
          type: "resume-restart",
          hostColor: app.currentHostColor || app.desiredHostColor || Game.BLACK
        });
      } catch (error) {
        beginReconnect(deps.failed("やり直しを相手に届けられませんでした。", error));
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
          switchToCom("相手とまたつながれませんでした。");
          return;
        }

        fallbackResult = deps.onReconnectTimeout("相手とまたつながれませんでした。");
        if (fallbackResult && typeof fallbackResult.then === "function") {
          withFallbackTimeout(fallbackResult, RECONNECT_HANDOFF_TIMEOUT_MS).then(function (handled) {
            if (!handled && !AppPeer.isConnected()) {
              switchToCom("相手とまたつながれませんでした。");
            }
          }).catch(function () {
            if (!AppPeer.isConnected()) {
              switchToCom("相手とまたつながれませんでした。");
            }
          });
          return;
        }

        if (!fallbackResult && !AppPeer.isConnected()) {
          switchToCom("相手とまたつながれませんでした。");
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
      if (app.practiceWhileWaiting && app.role === "host") {
        if (app.matchConfigured && !app.game.winner) {
          // COM と練習中に友だちが来た：知らせて、最初から対戦するか今の盤面を続けるか選ぶ
          beginResumeChoice();
          return;
        }
        // 練習が終わっていたら、そのまま友だちとの対局の準備へ
        app.practiceWhileWaiting = false;
        app.matchConfigured = false;
        app.currentHostColor = "";
        app.myColor = "";
        app.transportMode = "matchmaking";
        deps.clearRematch();
        deps.resetGame();
        deps.setOpponentProfile("友だち", "");
      }
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

      // 待っている間にホストが START していたら、つながったあとも準備OKのままにする
      var readyWhileWaiting = app.role === "host" && !app.matchConfigured && !!app.localStartReady;
      var firstJoin = app.role === "host" && !app.matchConfigured && app.transportMode === "matchmaking";
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
          deps.setMessage("相手とまたつながりました。盤面をそろえています。");
        } else {
          sendProfile();
          // つながった時点のルール（教養モード・盤面の大きさなど）を相手にも見せる
          sendSetupState();
          if (readyWhileWaiting) {
            app.localStartReady = true;
            try {
              AppPeer.send({ type: "start-ready", hostColor: app.desiredHostColor, rules: app.rules });
            } catch (error) {
              app.localStartReady = false;
            }
          }
          deps.setMessage(readyWhileWaiting ?
            "友だちが参加しました。あなたは準備OKです。友だちの START で始まります。" :
            "友だちが参加しました。色を決めて、2人とも START を押してください。");
          if (firstJoin && deps.notifyJoined) {
            deps.notifyJoined(app.opponentDisplayName && app.opponentDisplayName !== "参加待ち" ? app.opponentDisplayName : "友だち");
          }
        }
        return;
      }

      sendProfile();
      deps.setMessage("相手とつながりました。色を決めて、2人とも START を押してね。");
    }

    function makeMove(row, col, color, source, version) {
      var expectedVersion = app.game.version + 1;
      var message;

      if (version && version !== expectedVersion) {
        if (source === "remote") {
          switchToCom("相手と盤面がずれてしまいました。");
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
      if (applyLifeTiebreak()) {
        message = app.game.message;
      }
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
          beginReconnect(deps.failed("相手に届けられませんでした。", error));
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
      var prompt = {
        row: row,
        col: col,
        color: color,
        attempt: attempt,
        question: currentQuestion(row, col),
        chosen: null,
        deadline: app.rules.timeLimit ? Date.now() + app.rules.timeLimit * 1000 : 0
      };
      prompt.inputMode = isInputQuestion(prompt.question);
      app.quizPrompt = prompt;
      // 回答タイム：時間が来たら「時間切れ」（不正解あつかい）
      deps.stopTimer("quizTimer");
      if (prompt.deadline) {
        app.quizTimer = window.setTimeout(function () {
          if (app.quizPrompt === prompt && prompt.chosen === null) {
            answerQuiz(TIME_UP);
          }
        }, app.rules.timeLimit * 1000);
      }
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
      if (attempt !== (app.quizAttempts[quizKey(row, col)] || 0)) {
        return;
      }
      app.opponentQuiz = {
        row: row,
        col: col,
        attempt: attempt,
        color: opponentColor,
        question: currentQuestion(row, col),
        chosen: null,
        inputMode: isInputQuestion(currentQuestion(row, col)),
        deadline: app.rules.timeLimit ? Date.now() + app.rules.timeLimit * 1000 : 0
      };
    }

    // index = 選んだ選択肢（-1 は「わからない」）。結果を少し見せてから反映する
    // 入力で答えたとき：合っていれば正解の番号、ちがえば TYPED_WRONG として answerQuiz に渡す
    function answerQuizText(text) {
      var prompt = app.quizPrompt;
      if (!prompt || prompt.chosen !== null || !prompt.inputMode || !String(text || "").trim()) {
        return;
      }
      answerQuiz(Quiz.checkInput(prompt.question, text) ? prompt.question.answer : TYPED_WRONG, String(text).trim().slice(0, 40));
    }

    function answerQuiz(index, typed) {
      var prompt = app.quizPrompt;
      if (!prompt || prompt.chosen !== null) {
        return;
      }
      deps.stopTimer("quizTimer");
      prompt.chosen = Number(index);
      prompt.correct = prompt.chosen === prompt.question.answer;
      prompt.typed = typeof typed === "string" ? typed : "";
      sendQuizProgress({ type: "quiz-choice", chosen: prompt.chosen, typed: prompt.typed });
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
          switchToCom("相手と盤面がずれてしまいました。");
        }
        return false;
      }
      var key = quizKey(row, col);
      // 次にこのマスで出す問題は、盤面のほかの問題と重ならない位置から選ぶ
      var nextPosition = Quiz.nextRetryPosition(app.rules, app.game.board, app.quizRetries);
      app.quizRetries[key] = (app.quizRetries[key] || []).slice(0, app.quizAttempts[key] || 0).concat([nextPosition]);
      app.quizAttempts[key] = (app.quizAttempts[key] || 0) + 1;
      app.game.version = version || expectedVersion;
      app.opponentQuiz = null;
      if (app.rules.lives && (app.quizLives[color] || 0) > 0) {
        // ライフが残っていれば、ライフを1つ減らして同じ人がもう一度選べる
        app.quizLives[color] -= 1;
        app.game.message = Game.colorName(color) + "は不正解。ライフが1つ減りました（のこり " + app.quizLives[color] + "）。もう一度選べます。";
      } else {
        app.game.message = Game.passTurnAfterMiss(app.game, color);
        applyLifeTiebreak();
      }
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
          beginReconnect(deps.failed("相手に届けられませんでした。", error));
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
        deps.setMessage("再戦をお願いしました。返事を待っています。");
        deps.stopTimer("rematchTimer");
        app.rematchTimer = window.setTimeout(function () {
          if (!app.rematch.outgoing) {
            return;
          }
          app.rematch.outgoing = false;
          deps.setMessage("再戦の返事がありませんでした。もう一度お願いするか、閉じられます。");
          deps.render();
        }, REMATCH_RESPONSE_TIMEOUT_MS);
      } catch (error) {
        deps.stopTimer("rematchTimer");
        app.rematch.outgoing = false;
        beginReconnect(deps.failed("再戦のお願いを届けられませんでした。", error));
      }
    }

    function acceptRematch() {
      if (!app.rematch.incoming || !AppPeer.isConnected()) {
        return;
      }
      try {
        AppPeer.send({ type: "rematch-accept" });
      } catch (error) {
        beginReconnect(deps.failed("再戦の返事を届けられませんでした。", error));
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
          beginReconnect(deps.failed("再戦の返事を届けられませんでした。", error));
        }
      }
      deps.setMessage("この試合を終了しました。続ける場合は新しいルームを作成するか、ページを開き直してください。");
    }

    // 相手の端末から届いた知らせ。形・範囲・いまの場面に合うものだけ受けつける（合わないものは読み飛ばす）
    function handlePeerData(data) {
      if (!data || typeof data !== "object" || typeof data.type !== "string") {
        return;
      }
      var isHost = app.role === "host";
      var move;
      var state;
      var choice;
      var profile;
      if (data.type === "move" || data.type === "miss") {
        if (app.transportMode !== "p2p" || !app.matchConfigured) {
          return;
        }
        move = Guard.cleanRemoteMove(data, app.game, app.myColor);
        if (!move) {
          switchToCom("相手から無効な手が送信されました。");
        } else if (data.type === "move") {
          makeMove(move.row, move.col, move.color, "remote", move.version);
        } else {
          applyMiss(move.row, move.col, move.color, "remote", move.version);
        }
      } else if (data.type === "start") {
        if (isHost || app.matchConfigured || !Guard.isColor(data.hostColor)) {
          return;
        }
        if (data.rules) {
          app.rules = Quiz.normalizeRules(data.rules);
        }
        applyMatchSettings(data.hostColor, false);
      } else if (data.type === "setup-sync") {
        if (app.matchConfigured) {
          return;
        }
        if (data.rules && !isHost) {
          applyRules(data.rules);
        }
        if (Guard.isColor(data.hostColor)) {
          app.desiredHostColor = data.hostColor;
        }
        clearStartReady();
        deps.setMessage("開始前の設定が更新されました。色を確認して、2人とも START を押してください。");
      } else if (data.type === "start-ready") {
        if (app.matchConfigured) {
          return;
        }
        app.remoteStartReady = true;
        if (Guard.isColor(data.hostColor)) {
          app.desiredHostColor = data.hostColor;
        }
        if (data.rules && !isHost) {
          applyRules(data.rules);
        }
        deps.setMessage(app.localStartReady ?
          "両者の START が揃いました。開始しています。" :
          "相手は START 準備OKです。あなたも START を押してください。");
        tryStartHumanMatch();
      } else if (data.type === "quiz-open") {
        showOpponentQuiz(data);
      } else if (data.type === "quiz-choice") {
        choice = Guard.cleanQuizChoice(data);
        if (choice && app.opponentQuiz && app.opponentQuiz.chosen === null) {
          app.opponentQuiz.chosen = choice.chosen;
          app.opponentQuiz.correct = choice.chosen === app.opponentQuiz.question.answer;
          app.opponentQuiz.typed = choice.typed;
        }
      } else if (data.type === "profile") {
        profile = Guard.cleanProfile(data);
        deps.setOpponentProfile(profile.displayName || "対戦相手", profile.pictureUrl);
      } else if (data.type === "state") {
        // 盤面をそろえる知らせは、ホストからだけ
        state = !isHost && Guard.cleanSharedState(data);
        if (!state) {
          return;
        }
        applySharedState(state);
        finalizeP2PResume("相手とまたつながりました。盤面をそろえています。");
      } else if (data.type === "resume-preview") {
        state = Guard.cleanSharedState(data.payload);
        if (!state) {
          return;
        }
        enterSpectatorMode(data, state);
      } else if (data.type === "resume-continue") {
        state = app.spectatorMode && Guard.cleanSharedState(data.payload);
        if (!state) {
          return;
        }
        applySharedState(state);
        finalizeP2PResume("今の盤面から対局を再開しました。");
      } else if (data.type === "resume-restart") {
        if (!app.spectatorMode) {
          return;
        }
        clearResumeState();
        clearStartReady();
        app.opponentMode = "human";
        app.transportMode = "p2p";
        deps.setTransport("WebRTC 接続済み");
        deps.setOpponentStatus("接続済み");
        if (Guard.isColor(data.hostColor)) {
          app.currentHostColor = data.hostColor;
          app.desiredHostColor = data.hostColor;
        }
        prepareRematchSetup();
        deps.setMessage("最初からやり直します。色を決めて、2人とも START を押してください。");
      } else if (data.type === "rematch-request") {
        if (!app.game.winner) {
          return;
        }
        app.rematch.incoming = true;
        app.rematch.outgoing = false;
        app.resultOverlayDismissed = false;
        deps.setMessage("相手がもう一戦したいそうです。");
      } else if (data.type === "rematch-accept") {
        if (isHost && app.rematch.outgoing) {
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
        // 次の対局の準備へ移るのは、ホストからの知らせで、対局中でないときだけ
        if (isHost || (app.matchConfigured && !app.game.winner)) {
          return;
        }
        prepareRematchSetup();
      } else {
        return;
      }
      deps.render();
    }

    return {
      applyMatchSettings: applyMatchSettings,
      openQuiz: openQuiz,
      answerQuiz: answerQuiz,
      answerQuizText: answerQuizText,
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
