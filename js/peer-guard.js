(function (window) {
  // 相手の端末・URL から届く中身を、使う前に確かめる（形・範囲・ルール）。
  // 画面に触らないので node のテスト（test/peer-guard.test.js）でも動かせる
  var Game = window.OthelloGame;
  var Quiz = window.OthelloQuiz;
  var NAME_MAX = 40;
  var MESSAGE_MAX = 200;
  var TYPED_MAX = 40;
  var ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
  // プロフィール画像は LINE の画像の置き場所だけ
  var PICTURE_HOSTS = /^(profile|obs|sprofile)\.line-scdn\.net$/;
  var WINNERS = ["", "黒", "白", "引き分け"];

  function isColor(value) {
    return value === Game.BLACK || value === Game.WHITE;
  }

  function cleanText(value, max) {
    return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) : "";
  }

  function toInt(value, min, max) {
    if ((typeof value !== "number" && typeof value !== "string") || value === "") {
      return null;
    }
    var number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max) {
      return null;
    }
    return number;
  }

  function isRoomId(value) {
    return typeof value === "string" && ROOM_ID_PATTERN.test(value);
  }

  function cleanPictureUrl(value) {
    if (typeof value !== "string" || value.length > 500) {
      return "";
    }
    try {
      var url = new URL(value);
      return url.protocol === "https:" && PICTURE_HOSTS.test(url.hostname) ? url.href : "";
    } catch (error) {
      return "";
    }
  }

  function cleanProfile(data) {
    var input = data || {};
    return {
      displayName: cleanText(input.displayName, NAME_MAX),
      pictureUrl: cleanPictureUrl(input.pictureUrl)
    };
  }

  // 盤面：6 か 8 の大きさで、各行が "B" "W" "." だけの文字
  function isBoardRows(rows) {
    if (!Array.isArray(rows) || Game.BOARD_SIZES.indexOf(rows.length) === -1) {
      return false;
    }
    return rows.every(function (row) {
      return typeof row === "string" && row.length === rows.length && /^[BW.]+$/.test(row);
    });
  }

  function cleanCellMap(value, size, cleanValue) {
    var output = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return output;
    }
    Object.keys(value).slice(0, size * size).forEach(function (key) {
      var match = /^(\d+)-(\d+)$/.exec(key);
      if (!match || Number(match[1]) >= size || Number(match[2]) >= size) {
        return;
      }
      var cleaned = cleanValue(value[key]);
      if (cleaned !== null) {
        output[key] = cleaned;
      }
    });
    return output;
  }

  function cleanAttempt(value) {
    return toInt(value, 0, 999);
  }

  function cleanRetryList(value) {
    if (!Array.isArray(value)) {
      return null;
    }
    var list = value.slice(0, 1000).map(function (item) { return toInt(item, 0, 100000); });
    return list.indexOf(null) === -1 ? list : null;
  }

  function cleanLives(value) {
    var output = {};
    var input = value && typeof value === "object" ? value : {};
    output[Game.BLACK] = toInt(input[Game.BLACK], 0, 99) || 0;
    output[Game.WHITE] = toInt(input[Game.WHITE], 0, 99) || 0;
    return output;
  }

  // 盤面をそろえる知らせ（state / resume-preview / resume-continue の中身）。形がおかしければ null
  function cleanSharedState(payload) {
    if (!payload || typeof payload !== "object" || !isBoardRows(payload.board)) {
      return null;
    }
    var size = payload.board.length;
    var currentTurn = payload.currentTurn === "" || payload.currentTurn === undefined ? "" : payload.currentTurn;
    if (currentTurn !== "" && !isColor(currentTurn)) {
      return null;
    }
    var version = toInt(payload.version || 0, 0, 10000);
    if (version === null) {
      return null;
    }
    if (payload.hostColor && !isColor(payload.hostColor)) {
      return null;
    }
    var winner = payload.winner || "";
    if (WINNERS.indexOf(winner) === -1) {
      return null;
    }
    var cleaned = {
      board: payload.board.slice(),
      currentTurn: currentTurn,
      version: version,
      winner: winner,
      message: cleanText(payload.message, MESSAGE_MAX),
      matchConfigured: !!payload.matchConfigured,
      hostColor: payload.hostColor || ""
    };
    if (payload.rules) {
      cleaned.rules = Quiz.normalizeRules(payload.rules);
      if (cleaned.rules.size !== size) {
        return null;
      }
      cleaned.quizAttempts = cleanCellMap(payload.quizAttempts, size, cleanAttempt);
      cleaned.quizRetries = cleanCellMap(payload.quizRetries, size, cleanRetryList);
      cleaned.quizLives = cleanLives(payload.quizLives);
    }
    return cleaned;
  }

  // 相手が置いた手・不正解の知らせ：相手の色で、いまが相手の番で、盤面の中のマス
  function cleanRemoteMove(data, game, myColor) {
    if (!data || !isColor(data.color) || !isColor(myColor) || data.color !== Game.getOpponent(myColor)) {
      return null;
    }
    if (game.winner || game.currentTurn !== data.color) {
      return null;
    }
    var size = Game.sizeOf(game.board);
    var row = toInt(data.row, 0, size - 1);
    var col = toInt(data.col, 0, size - 1);
    var version = toInt(data.version, 1, 10000);
    if (row === null || col === null || version === null) {
      return null;
    }
    return { row: row, col: col, color: data.color, version: version };
  }

  function cleanQuizChoice(data) {
    var chosen = toInt(data && data.chosen, -3, 9);
    if (chosen === null) {
      return null;
    }
    return { chosen: chosen, typed: cleanText(data.typed, TYPED_MAX) };
  }

  var Guard = {
    isColor: isColor,
    isRoomId: isRoomId,
    isBoardRows: isBoardRows,
    cleanText: cleanText,
    cleanPictureUrl: cleanPictureUrl,
    cleanProfile: cleanProfile,
    cleanSharedState: cleanSharedState,
    cleanRemoteMove: cleanRemoteMove,
    cleanQuizChoice: cleanQuizChoice
  };

  window.OthelloPeerGuard = Guard;
}(window));
