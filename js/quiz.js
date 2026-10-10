// 教養モードの問題。マスごとの問題は「問題の種・マス・何回目の挑戦か」から決まるので、
// 通信対戦でも両方の端末で同じ問題・同じ選択肢の並びになる（問題そのものは送らない）。
(function (window) {
  var Data = window.OthelloQuizData || {};

  // ジャンルとレベル。label は画面に出す名前
  var GENRES = [
    { id: "kanji", label: "漢字", icon: "🈷️", levels: [
      { id: "e", label: "小学" }, { id: "j", label: "中学" }, { id: "h", label: "高校" }
    ] },
    { id: "english", label: "英単語", icon: "🔤", levels: [
      { id: "j", label: "中学" }, { id: "h", label: "高校" }, { id: "u", label: "大学" }
    ] },
    { id: "proverb", label: "ことわざ・四字熟語", icon: "📜", levels: [
      { id: "kotowaza", label: "ことわざ" }, { id: "yoji", label: "四字熟語" }
    ] },
    { id: "general", label: "一般教養", icon: "🌏", levels: [
      { id: "basic", label: "やさしい" }, { id: "advanced", label: "むずかしい" }
    ] },
    { id: "math", label: "数学", icon: "🧮", levels: [
      { id: "e", label: "小学" }, { id: "j", label: "中学" }, { id: "h", label: "高校" }, { id: "u", label: "大学（微積）" }
    ] }
  ];

  function findGenre(genreId) {
    var index;
    for (index = 0; index < GENRES.length; index += 1) {
      if (GENRES[index].id === genreId) {
        return GENRES[index];
      }
    }
    return GENRES[0];
  }

  function normalizeRules(rules) {
    var input = rules || {};
    var genre = findGenre(input.genre);
    var level = genre.levels[0].id;
    var index;
    for (index = 0; index < genre.levels.length; index += 1) {
      if (genre.levels[index].id === input.level) {
        level = input.level;
      }
    }
    return {
      mode: input.mode === "quiz" ? "quiz" : "normal",
      size: window.OthelloGame.normalizeSize(input.size),
      genre: genre.id,
      level: level,
      seed: Number(input.seed) >>> 0 || 1
    };
  }

  function levelLabel(rules) {
    var genre = findGenre(rules.genre);
    var index;
    for (index = 0; index < genre.levels.length; index += 1) {
      if (genre.levels[index].id === rules.level) {
        return genre.levels[index].label;
      }
    }
    return "";
  }

  function describe(rules) {
    var genre = findGenre(rules.genre);
    return genre.icon + " " + genre.label + "（" + levelLabel(rules) + "）";
  }

  // ---- 乱数（種から毎回同じ並びを出す） ----
  function hashString(text) {
    var hash = 2166136261;
    var index;
    for (index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function createRandom(seed) {
    var state = seed >>> 0;
    return function () {
      state = (state + 0x6d2b79f5) >>> 0;
      var t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randomInt(random, min, max) {
    return min + Math.floor(random() * (max - min + 1));
  }

  function pick(random, list) {
    return list[Math.floor(random() * list.length)];
  }

  // 正解1つ＋まちがい3つを混ぜて4択にする（同じ文字列は入れない）
  function buildChoices(random, answer, wrongs) {
    var choices = [String(answer)];
    var index;
    var item;
    for (index = 0; index < wrongs.length && choices.length < 4; index += 1) {
      item = String(wrongs[index]);
      if (choices.indexOf(item) === -1) {
        choices.push(item);
      }
    }
    // まちがいが正解と重なって4つに足りないとき（数学の数値の答え）は、正解からずらした数で補う
    var offsets = [3, -3, 4, -4, 5, 7, -7, 9];
    for (index = 0; index < offsets.length && choices.length < 4 && !isNaN(Number(answer)); index += 1) {
      item = String(Number(answer) + offsets[index]);
      if (choices.indexOf(item) === -1) {
        choices.push(item);
      }
    }
    for (index = choices.length - 1; index > 0; index -= 1) {
      var swap = Math.floor(random() * (index + 1));
      var temp = choices[index];
      choices[index] = choices[swap];
      choices[swap] = temp;
    }
    return { choices: choices, answer: choices.indexOf(String(answer)) };
  }

  // ---- 盤面の1文字（問題の特徴を表す） ----
  //   漢字・ことわざ・四字熟語：そのレベルの中でいちばん珍しい漢字（「一」のような共通の字を避ける）
  //   英単語：頭文字  一般教養：問題ごとに用意したキーワード(m)  数学：問題の種類の記号
  var markCache = {};

  function distinctiveMarks(cacheKey, words) {
    if (markCache[cacheKey]) {
      return markCache[cacheKey];
    }
    var freq = {};
    words.forEach(function (word) {
      Array.from(word).forEach(function (ch) { freq[ch] = (freq[ch] || 0) + 1; });
    });
    var marks = words.map(function (word) {
      var chars = Array.from(word);
      var kanji = chars.filter(function (ch) { return /[一-鿿]/.test(ch); });
      var candidates = kanji.length ? kanji : chars;
      var best = candidates[0];
      candidates.forEach(function (ch) {
        if (freq[ch] < freq[best]) {
          best = ch;
        }
      });
      return best;
    });
    markCache[cacheKey] = marks;
    return marks;
  }

  // ---- 言葉の組（「問い → 答え」）から作る問題 ----
  //   まちがいの選択肢は、同じレベルの別の組の答えから選ぶ
  function fromPair(random, pairs, index, template, mark) {
    var target = pairs[index];
    var wrongs = [];
    var guard = 0;
    while (wrongs.length < 3 && guard < 200) {
      var other = pick(random, pairs)[1];
      if (other !== target[1] && wrongs.indexOf(other) === -1) {
        wrongs.push(other);
      }
      guard += 1;
    }
    var built = buildChoices(random, target[1], wrongs);
    return { text: template.replace("{q}", target[0]), choices: built.choices, answer: built.answer, mark: mark };
  }

  function fromAuthored(random, item) {
    var built = buildChoices(random, item.a, item.w);
    return { text: item.q, choices: built.choices, answer: built.answer, mark: item.m || Array.from(item.q)[0] };
  }

  // ---- 数学（その場で計算するので、答えは必ず正しい） ----
  function fraction(numerator, denominator) {
    function gcd(a, b) { return b ? gcd(b, a % b) : Math.abs(a); }
    var divisor = gcd(numerator, denominator);
    var n = numerator / divisor;
    var d = denominator / divisor;
    if (d < 0) { n = -n; d = -d; }
    return d === 1 ? String(n) : n + "/" + d;
  }

  function numberWrongs(answer, deltas) {
    return deltas.map(function (delta) { return answer + delta; });
  }

  function signed(value) {
    return value < 0 ? "− " + -value : "+ " + value;
  }

  // それぞれ { text, answer, wrongs, mark }。mark は盤面に出す記号
  var MATH = {
    // 小学：四則計算
    e: function (random) {
      var kind = randomInt(random, 0, 3);
      var a;
      var b;
      if (kind === 0) {
        a = randomInt(random, 12, 89); b = randomInt(random, 12, 89);
        return { text: a + " + " + b + " = ?", answer: a + b, wrongs: numberWrongs(a + b, [10, -10, 1]), mark: "+" };
      }
      if (kind === 1) {
        a = randomInt(random, 40, 99); b = randomInt(random, 11, a - 1);
        return { text: a + " − " + b + " = ?", answer: a - b, wrongs: numberWrongs(a - b, [10, -1, 1]), mark: "−" };
      }
      if (kind === 2) {
        a = randomInt(random, 3, 9); b = randomInt(random, 12, 19);
        return { text: a + " × " + b + " = ?", answer: a * b, wrongs: numberWrongs(a * b, [a, -a, 10]), mark: "×" };
      }
      b = randomInt(random, 3, 9); a = b * randomInt(random, 4, 12);
      return { text: a + " ÷ " + b + " = ?", answer: a / b, wrongs: numberWrongs(a / b, [1, -1, 2]), mark: "÷" };
    },
    // 中学：一次方程式・平方根・展開
    j: function (random) {
      var kind = randomInt(random, 0, 2);
      var a;
      var b;
      var x;
      if (kind === 0) {
        a = randomInt(random, 2, 9); x = randomInt(random, -9, 9); b = randomInt(random, -20, 20);
        return { text: a + "x " + signed(b) + " = " + (a * x + b) + " のとき x = ?", answer: x, wrongs: [x + 1, x - 1, -x === x ? x + 2 : -x], mark: "x" };
      }
      if (kind === 1) {
        a = randomInt(random, 11, 25);
        return { text: "√" + a * a + " = ?", answer: a, wrongs: [a + 1, a - 1, a + 2], mark: "√" };
      }
      a = randomInt(random, 1, 9); b = randomInt(random, 1, 9);
      return { text: "(x + " + a + ")(x + " + b + ") を展開したときの x の係数は？", answer: a + b, wrongs: [a * b, a + b + 1, Math.abs(a - b) === a + b ? a + b + 2 : Math.abs(a - b)], mark: "(" };
    },
    // 高校：微分係数・定積分
    h: function (random) {
      var kind = randomInt(random, 0, 1);
      var a = randomInt(random, 1, 5);
      var b = randomInt(random, -6, 6);
      var k = randomInt(random, 1, 4);
      if (kind === 0) {
        var answer = 2 * a * k + b;
        return { text: "f(x) = " + (a === 1 ? "" : a) + "x² " + signed(b) + "x のとき f′(" + k + ") = ?", answer: answer, wrongs: [a * k * k + b * k, answer + 2, 2 * a * k], mark: "f" };
      }
      // ∫₀ᵏ (2a·x + b) dx = a·k² + b·k
      var value = a * k * k + b * k;
      return { text: "∫₀^" + k + " (" + 2 * a + "x " + signed(b) + ") dx = ?", answer: value, wrongs: [2 * a * k + b, value + k, value - k], mark: "∫" };
    },
    // 大学：微分積分（8×8 の空きマス60でも重ならないよう、問題文が80通り以上になる幅にしている）
    u: function (random) {
      var kind = randomInt(random, 0, 4);
      var a;
      var n;
      var k;
      if (kind === 0) {
        a = randomInt(random, 2, 15);
        return { text: "d/dx e^(" + a + "x) の x = 0 での値は？", answer: a, wrongs: [1, a * a, a + 1], mark: "e" };
      }
      if (kind === 1) {
        n = randomInt(random, 2, 15);
        return { text: "∫₀¹ x^" + n + " dx = ?", answer: fraction(1, n + 1), wrongs: [fraction(1, n), fraction(n, n + 1), fraction(1, n + 2)], mark: "∫" };
      }
      if (kind === 2) {
        a = randomInt(random, 2, 20);
        return { text: "lim(x→0) sin(" + a + "x) / x = ?", answer: a, wrongs: [1, 0, fraction(1, a)], mark: "→" };
      }
      if (kind === 3) {
        // d/dx x^n の x = k での値 = n·k^(n−1)
        n = randomInt(random, 2, 6); k = randomInt(random, 1, 4);
        var value = n * Math.pow(k, n - 1);
        return { text: "d/dx (x^" + n + ") の x = " + k + " での値は？", answer: value, wrongs: [Math.pow(k, n), n * Math.pow(k, n), (n - 1) * Math.pow(k, n - 1)], mark: "d" };
      }
      // d/dx log x の x = k での値 = 1/k
      k = randomInt(random, 2, 15);
      return { text: "d/dx (log x) の x = " + k + " での値は？", answer: fraction(1, k), wrongs: [String(k), fraction(1, k * k), fraction(1, k + 1)], mark: "ℓ" };
    }
  };

  function fromMath(random, level) {
    var made = (MATH[level] || MATH.e)(random);
    var built = buildChoices(random, made.answer, made.wrongs);
    return { text: made.text, choices: built.choices, answer: built.answer, mark: made.mark };
  }

  // ---- 盤面への割り当て（同じ問題が盤面に重ならないように） ----
  //   空きマス（最初の4つの石以外）を左上から順に番号を付け、
  //   言葉の問題：種で並べ替えた問題の順に1つずつ割り当てる（問題数 ≥ マス数なら重複しない）
  //   数学：同じ問題文ができたら作り直す
  //   不正解のあと：まだ盤面で使っていない問題から出す
  function cellIndex(size, row, col) {
    var mid = size / 2;
    var index = 0;
    var r;
    var c;
    for (r = 0; r < size; r += 1) {
      for (c = 0; c < size; c += 1) {
        if ((r === mid - 1 || r === mid) && (c === mid - 1 || c === mid)) {
          continue;
        }
        if (r === row && c === col) {
          return index;
        }
        index += 1;
      }
    }
    return 0;
  }

  var permutationCache = {};

  function permutation(length, seed) {
    var cacheKey = length + ":" + seed;
    if (permutationCache[cacheKey]) {
      return permutationCache[cacheKey];
    }
    var random = createRandom(seed);
    var order = [];
    var index;
    for (index = 0; index < length; index += 1) {
      order.push(index);
    }
    for (index = length - 1; index > 0; index -= 1) {
      var swap = Math.floor(random() * (index + 1));
      var temp = order[index];
      order[index] = order[swap];
      order[swap] = temp;
    }
    permutationCache[cacheKey] = order;
    return order;
  }

  var mathBoards = {};

  // 数学：盤面全体の最初の問題を、重ならないよう左上から順に決めておく
  function mathBoard(rules, cellCount) {
    var key = [rules.seed, rules.level, rules.size].join(":");
    if (mathBoards[key]) {
      return mathBoards[key];
    }
    var used = {};
    var list = [];
    var index;
    for (index = 0; index < cellCount; index += 1) {
      list.push(uniqueMath(rules, index, 0, used));
    }
    mathBoards[key] = { list: list, used: used };
    return mathBoards[key];
  }

  function uniqueMath(rules, index, attempt, used) {
    var question;
    var salt;
    for (salt = 0; salt < 60; salt += 1) {
      question = fromMath(createRandom(hashString([rules.seed, "math", rules.level, index, attempt, salt].join(":"))), rules.level);
      if (!used[question.text]) {
        break;
      }
    }
    used[question.text] = true;
    return question;
  }

  // マスの問題。attempt はそのマスで何回目の挑戦か（不正解のあとは別の問題になる）
  function questionFor(rules, row, col, attempt) {
    var normalized = normalizeRules(rules);
    var tries = attempt || 0;
    var size = normalized.size;
    var cellCount = size * size - 4;
    var index = cellIndex(size, row, col);
    var random = createRandom(hashString([normalized.seed, normalized.genre, normalized.level, row, col, tries].join(":")));
    var question;

    if (normalized.genre === "math") {
      var board = mathBoard(normalized, cellCount);
      question = tries === 0 ? board.list[index] :
        uniqueMath(normalized, index, tries, Object.assign({}, board.used));
    } else {
      var bank = (Data[normalized.genre] && Data[normalized.genre][normalized.level]) || [];
      var order = permutation(bank.length, hashString([normalized.seed, normalized.genre, normalized.level, "order"].join(":")));
      // 最初は前から1つずつ、不正解のあとは盤面で使わなかった残りの問題から
      var position = tries === 0 ? index : cellCount + (index * 7 + tries * 13) % Math.max(1, bank.length - cellCount);
      var itemIndex = order[position % bank.length];
      if (normalized.genre === "general") {
        question = fromAuthored(random, bank[itemIndex]);
      } else {
        var marks = normalized.genre === "english" ?
          bank.map(function (pair) { return pair[0].charAt(0).toUpperCase(); }) :
          distinctiveMarks(normalized.genre + ":" + normalized.level, bank.map(function (pair) { return pair[0]; }));
        question = fromPair(random, bank, itemIndex,
          normalized.genre === "kanji" ? "「{q}」の読みは？" : "「{q}」の意味は？", marks[itemIndex]);
      }
    }
    question = Object.assign({}, question, { genre: normalized.genre });
    return question;
  }

  // 盤面に出す1文字
  function markFor(rules, row, col, attempt) {
    return questionFor(rules, row, col, attempt).mark || "";
  }

  function newSeed() {
    return (Math.floor(Math.random() * 4294967295) >>> 0) || 1;
  }

  // COM が正解する確率（レベルが上がるほど少し下がる）
  function comAccuracy(rules) {
    var genre = findGenre(rules.genre);
    var index = 0;
    var i;
    for (i = 0; i < genre.levels.length; i += 1) {
      if (genre.levels[i].id === rules.level) {
        index = i;
      }
    }
    return Math.max(0.5, 0.8 - index * 0.08);
  }

  window.OthelloQuiz = {
    GENRES: GENRES,
    findGenre: findGenre,
    normalizeRules: normalizeRules,
    describe: describe,
    questionFor: questionFor,
    markFor: markFor,
    newSeed: newSeed,
    comAccuracy: comAccuracy
  };
}(window));
