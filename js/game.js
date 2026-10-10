(function (window) {
  // 盤面の大きさの初期値。教養モードでは 6 / 8 から選べる（最初の4つの石を中央に置くため偶数のみ）
  var BOARD_SIZE = 8;
  var BOARD_SIZES = [6, 8];
  var BLACK = "B";
  var WHITE = "W";

  function getOpponent(color) {
    return color === BLACK ? WHITE : BLACK;
  }

  function colorName(color) {
    return color === BLACK ? "黒" : "白";
  }

  function normalizeSize(size) {
    return BOARD_SIZES.indexOf(Number(size)) !== -1 ? Number(size) : BOARD_SIZE;
  }

  // 盤面の大きさは配列の長さで決まる（どの関数も固定の 8 を使わない）
  function sizeOf(board) {
    return board && board.length ? board.length : BOARD_SIZE;
  }

  function createInitialBoard(size) {
    var boardSize = normalizeSize(size);
    var mid = boardSize / 2;
    var board = [];
    var row;
    var col;

    for (row = 0; row < boardSize; row += 1) {
      board[row] = [];
      for (col = 0; col < boardSize; col += 1) {
        board[row][col] = "";
      }
    }

    board[mid - 1][mid - 1] = WHITE;
    board[mid - 1][mid] = BLACK;
    board[mid][mid - 1] = BLACK;
    board[mid][mid] = WHITE;
    return board;
  }

  function createFreshGame(size) {
    return {
      board: createInitialBoard(size),
      currentTurn: BLACK,
      version: 0,
      winner: "",
      message: "黒が先手です。両プレイヤーの接続を待っています。",
      lastMove: null
    };
  }

  function serializeBoard(board) {
    var rows = [];
    var row;
    var col;
    var text;

    for (row = 0; row < sizeOf(board); row += 1) {
      text = "";
      for (col = 0; col < sizeOf(board); col += 1) {
        text += board[row][col] || ".";
      }
      rows.push(text);
    }

    return rows;
  }

  function deserializeBoard(rows) {
    var boardSize = normalizeSize(rows && rows.length);
    var board = [];
    var row;
    var col;
    var rowText;

    for (row = 0; row < boardSize; row += 1) {
      board[row] = [];
      rowText = rows && rows[row] ? rows[row] : "";
      for (col = 0; col < boardSize; col += 1) {
        board[row][col] = rowText.charAt(col) === "." || !rowText.charAt(col) ? "" : rowText.charAt(col);
      }
    }

    return board;
  }

  function isOnBoard(board, row, col) {
    return row >= 0 && row < sizeOf(board) && col >= 0 && col < sizeOf(board);
  }

  function getFlips(board, row, col, color) {
    var opponent = getOpponent(color);
    var directions = [
      [-1, -1], [-1, 0], [-1, 1],
      [0, -1],           [0, 1],
      [1, -1],  [1, 0],  [1, 1]
    ];
    var dirIndex;
    var direction;
    var currentRow;
    var currentCol;
    var pending;
    var flips = [];

    if (!isOnBoard(board, row, col) || board[row][col]) {
      return flips;
    }

    for (dirIndex = 0; dirIndex < directions.length; dirIndex += 1) {
      direction = directions[dirIndex];
      currentRow = row + direction[0];
      currentCol = col + direction[1];
      pending = [];

      while (isOnBoard(board, currentRow, currentCol) && board[currentRow][currentCol] === opponent) {
        pending.push({ row: currentRow, col: currentCol });
        currentRow += direction[0];
        currentCol += direction[1];
      }

      if (pending.length &&
          isOnBoard(board, currentRow, currentCol) &&
          board[currentRow][currentCol] === color) {
        flips = flips.concat(pending);
      }
    }

    return flips;
  }

  function getValidMoves(board, color) {
    var moves = [];
    var row;
    var col;
    var flips;

    if (!color) {
      return moves;
    }

    for (row = 0; row < sizeOf(board); row += 1) {
      for (col = 0; col < sizeOf(board); col += 1) {
        flips = getFlips(board, row, col, color);
        if (flips.length) {
          moves.push({ row: row, col: col, flips: flips });
        }
      }
    }

    return moves;
  }

  function getMoveMap(validMoves) {
    var output = {};
    var index;
    var key;

    for (index = 0; index < validMoves.length; index += 1) {
      key = validMoves[index].row + "-" + validMoves[index].col;
      output[key] = validMoves[index];
    }

    return output;
  }

  function countDiscs(board) {
    var black = 0;
    var white = 0;
    var row;
    var col;

    for (row = 0; row < sizeOf(board); row += 1) {
      for (col = 0; col < sizeOf(board); col += 1) {
        if (board[row][col] === BLACK) {
          black += 1;
        } else if (board[row][col] === WHITE) {
          white += 1;
        }
      }
    }

    return { black: black, white: white };
  }

  function applyMove(board, row, col, color) {
    var flips = getFlips(board, row, col, color);
    var index;

    if (!flips.length) {
      return false;
    }

    board[row][col] = color;
    for (index = 0; index < flips.length; index += 1) {
      board[flips[index].row][flips[index].col] = color;
    }

    return true;
  }

  function resolveTurnAfterMove(game, lastColor) {
    var nextColor = getOpponent(lastColor);
    var nextMoves = getValidMoves(game.board, nextColor);
    var sameMoves = getValidMoves(game.board, lastColor);
    var counts;

    if (nextMoves.length) {
      game.currentTurn = nextColor;
      game.winner = "";
      return colorName(nextColor) + "の手番です。";
    }

    if (sameMoves.length) {
      game.currentTurn = lastColor;
      game.winner = "";
      return colorName(nextColor) + "は置ける場所がありません。もう一度" + colorName(lastColor) + "の手番です。";
    }

    counts = countDiscs(game.board);
    game.currentTurn = "";
    game.winner = counts.black === counts.white ? "引き分け" : (counts.black > counts.white ? "黒" : "白");

    if (game.winner === "引き分け") {
      return "ゲーム終了。 " + counts.black + "対" + counts.white + "で引き分けです。";
    }

    return "ゲーム終了。 " + game.winner + "の勝ちです。スコアは " + counts.black + "対" + counts.white + " です。";
  }

  function outcomeForColor(winner, color) {
    if (!winner) {
      return "";
    }
    if (winner === "引き分け") {
      return "draw";
    }
    return colorName(color) === winner ? "win" : "lose";
  }

  // 教養モードで問題に答えられなかったとき：石は置かず、手番を相手に渡す
  //   相手が置けなければ、そのままもう一度自分の番（通常の「置けない時はパス」と同じ考え方）
  function passTurnAfterMiss(game, color) {
    var nextColor = getOpponent(color);
    if (getValidMoves(game.board, nextColor).length) {
      game.currentTurn = nextColor;
      return "不正解でした。" + colorName(nextColor) + "の手番です。";
    }
    game.currentTurn = color;
    return "不正解でした。" + colorName(nextColor) + "は置ける場所がないので、もう一度" + colorName(color) + "の手番です。";
  }

  window.OthelloGame = {
    BOARD_SIZE: BOARD_SIZE,
    BOARD_SIZES: BOARD_SIZES,
    normalizeSize: normalizeSize,
    sizeOf: sizeOf,
    passTurnAfterMiss: passTurnAfterMiss,
    BLACK: BLACK,
    WHITE: WHITE,
    createFreshGame: createFreshGame,
    createInitialBoard: createInitialBoard,
    serializeBoard: serializeBoard,
    deserializeBoard: deserializeBoard,
    getOpponent: getOpponent,
    colorName: colorName,
    getValidMoves: getValidMoves,
    getMoveMap: getMoveMap,
    countDiscs: countDiscs,
    applyMove: applyMove,
    resolveTurnAfterMove: resolveTurnAfterMove,
    outcomeForColor: outcomeForColor
  };
}(window));
