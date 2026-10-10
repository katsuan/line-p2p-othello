// 教養モードの問題。マスごとの問題は「問題の種・マス・何回目の挑戦か」から決まるので、
// 通信対戦でも両方の端末で同じ問題・同じ選択肢の並びになる（問題そのものは送らない）。
(function (window) {
  // ジャンルとレベル。数学はその場で計算して作るので組み込み、それ以外は questions/*.json から読み込む（load）
  //   level.type: "pairs"（[問い, 答え] の組）/ "choices"（{ q, a, w: [まちがい3つ], m }）/ "math"
  var MATH_GENRE = { id: "math", label: "数学", icon: "🧮", order: 90, levels: [
    { id: "e", label: "小学", type: "math" }, { id: "j", label: "中学", type: "math" },
    { id: "h", label: "高校", type: "math" }, { id: "u", label: "大学（微積）", type: "math" }
  ] };
  var GENRES = [MATH_GENRE];
  var loaded = false;

  function findGenre(genreId) {
    var index;
    for (index = 0; index < GENRES.length; index += 1) {
      if (GENRES[index].id === genreId) {
        return GENRES[index];
      }
    }
    return GENRES[0];
  }

  function levelOf(pick) {
    var genre = findGenre(pick.genre);
    var found = genre.levels[0];
    genre.levels.forEach(function (level) {
      if (level.id === pick.level) {
        found = level;
      }
    });
    return found;
  }

  // ---- questions/*.json の読み込み ----
  //   形式がおかしい問題・ジャンルは読み飛ばして console に出す（ほかの問題はそのまま使える）
  function isText(value) {
    return typeof value === "string" && value.trim() !== "";
  }

  function validateGenre(raw, fileName) {
    if (!raw || !isText(raw.id) || !isText(raw.label) || !Array.isArray(raw.levels)) {
      console.warn("問題ファイルの形式が正しくありません:", fileName);
      return null;
    }
    if (raw.id === MATH_GENRE.id || GENRES.some(function (genre) { return genre.id === raw.id; })) {
      console.warn("ジャンル id が重複しているため読み飛ばします:", raw.id, fileName);
      return null;
    }
    var levels = raw.levels.map(function (level) {
      if (!level || !isText(level.id) || !isText(level.label) || !Array.isArray(level.items)) {
        return null;
      }
      var type = level.type === "choices" ? "choices" : "pairs";
      var seen = {};
      var items = level.items.filter(function (item) {
        var ok = type === "pairs" ?
          Array.isArray(item) && isText(item[0]) && isText(item[1]) :
          item && isText(item.q) && isText(item.a) && Array.isArray(item.w) && item.w.length >= 3 && item.w.every(isText);
        var key = type === "pairs" ? ok && item[0] : ok && item.q;
        if (!ok || seen[key]) {
          return false;
        }
        seen[key] = true;
        return true;
      });
      // pairs はまちがいの選択肢を同じレベルの別の組から選ぶので、4組以上必要
      if (items.length < (type === "pairs" ? 4 : 1)) {
        console.warn("問題が少ないレベルを読み飛ばします:", raw.id + ":" + level.id, fileName);
        return null;
      }
      return {
        id: level.id,
        label: level.label,
        type: type,
        template: isText(level.template) ? level.template : "「{q}」の意味は？",
        mark: level.mark === "first-letter" ? "first-letter" : "rare-kanji",
        items: items
      };
    }).filter(Boolean);
    if (!levels.length) {
      return null;
    }
    return {
      id: raw.id,
      label: raw.label,
      icon: isText(raw.icon) ? raw.icon : "📘",
      order: Number(raw.order) || 50,
      levels: levels
    };
  }

  // questions/index.json に並んだファイルを読み込む（index.json は公開時に scripts/build-question-index.sh が作る）
  function load(baseUrl) {
    var base = baseUrl || "questions/";
    var fetchJson = function (url) {
      return window.fetch(url, { cache: "no-cache" }).then(function (response) {
        if (!response.ok) {
          throw new Error(url + " " + response.status);
        }
        return response.json();
      });
    };
    return fetchJson(base + "index.json").then(function (files) {
      return Promise.all((Array.isArray(files) ? files : []).map(function (fileName) {
        return fetchJson(base + fileName).then(function (raw) {
          return { raw: raw, fileName: fileName };
        }).catch(function (error) {
          console.warn("問題ファイルを読み込めませんでした:", fileName, error);
          return null;
        });
      }));
    }).then(function (results) {
      var genres = [];
      results.filter(Boolean).forEach(function (result) {
        var genre = validateGenre(result.raw, result.fileName);
        if (genre && genres.some(function (g) { return g.id === genre.id; })) {
          console.warn("ジャンル id が重複しているため読み飛ばします:", genre.id, result.fileName);
        } else if (genre) {
          genres.push(genre);
        }
      });
      registerGenres(genres);
    }).catch(function (error) {
      console.warn("問題の一覧を読み込めませんでした。数学だけで遊べます:", error);
      registerGenres([]);
    });
  }

  // 両方の端末で同じ並びになるよう、order → id の順にそろえる（数学は最後）
  function registerGenres(genres) {
    var list = genres.concat([MATH_GENRE]);
    list.sort(function (a, b) { return (a.order - b.order) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
    GENRES.splice.apply(GENRES, [0, GENRES.length].concat(list));
    loaded = true;
    poolCache = {};
    markCache = {};
  }

  // 選んだ問題（ジャンル×レベル）の並び順。両方の端末で同じになるよう、GENRES の順にそろえる
  function pickOrder(pick) {
    var genreIndex = -1;
    var levelIndex = 0;
    GENRES.forEach(function (genre, gi) {
      if (genre.id === pick.genre) {
        genreIndex = gi;
        genre.levels.forEach(function (level, li) {
          if (level.id === pick.level) {
            levelIndex = li;
          }
        });
      }
    });
    return genreIndex * 10 + levelIndex;
  }

  function pickKey(pick) {
    return pick.genre + ":" + pick.level;
  }

  // 以前の形式 { genre, level } も読めるようにする
  function normalizePicks(input) {
    // 以前の { genre, level } 形式も読む。何も選んでいなければ空（教養モードは問題を選ぶまで始められない）
    var raw = Array.isArray(input.picks) ? input.picks : (input.genre ? [{ genre: input.genre, level: input.level }] : []);
    var seen = {};
    var picks = [];
    raw.forEach(function (item) {
      if (!item) {
        return;
      }
      var genre = null;
      GENRES.forEach(function (candidate) {
        if (candidate.id === item.genre) {
          genre = candidate;
        }
      });
      if (!genre) {
        return;
      }
      var level = genre.levels.some(function (l) { return l.id === item.level; }) ? item.level : genre.levels[0].id;
      var key = genre.id + ":" + level;
      if (!seen[key]) {
        seen[key] = true;
        picks.push({ genre: genre.id, level: level });
      }
    });
    picks.sort(function (a, b) { return pickOrder(a) - pickOrder(b); });
    return picks;
  }

  // ライフ：不正解でも、ライフが残っていればライフを1つ減らして同じ人がもう一度選べる（0 = なし）
  // 回答タイム：秒数を過ぎたら不正解あつかい（0 = なし）
  var LIFE_CHOICES = [0, 1, 3, 5];
  var TIME_CHOICES = [0, 10, 20, 30];
  var DEFAULT_LIVES = 3;
  var DEFAULT_TIME = 0;

  function pickChoice(value, choices, fallback) {
    var number = Number(value);
    return value !== undefined && value !== null && choices.indexOf(number) !== -1 ? number : fallback;
  }

  function normalizeRules(rules) {
    var input = rules || {};
    return {
      mode: input.mode === "quiz" ? "quiz" : "normal",
      size: window.OthelloGame.normalizeSize(input.size),
      picks: normalizePicks(input),
      lives: pickChoice(input.lives, LIFE_CHOICES, DEFAULT_LIVES),
      timeLimit: pickChoice(input.timeLimit, TIME_CHOICES, DEFAULT_TIME),
      seed: Number(input.seed) >>> 0 || 1
    };
  }

  // 1つの組み合わせを ON/OFF する（全部外すと「未選択」。START は問題を選ぶまで押せない）
  function togglePick(rules, key) {
    var parts = String(key).split(":");
    var picks = rules.picks.filter(function (pick) { return pickKey(pick) !== key; });
    if (picks.length === rules.picks.length) {
      picks = rules.picks.concat([{ genre: parts[0], level: parts[1] }]);
    }
    return picks;
  }

  // 対局を始められるか（教養モードは問題を1つ以上選んでいること）
  function isReady(rules) {
    var normalized = normalizeRules(rules);
    return normalized.mode !== "quiz" || normalized.picks.length > 0;
  }

  function hasPick(rules, key) {
    return rules.picks.some(function (pick) { return pickKey(pick) === key; });
  }

  function levelLabelOf(pick) {
    var genre = findGenre(pick.genre);
    var label = "";
    genre.levels.forEach(function (level) {
      if (level.id === pick.level) {
        label = level.label;
      }
    });
    return label;
  }

  function describePick(pick) {
    var genre = findGenre(pick.genre);
    return genre.icon + " " + genre.label + "（" + levelLabelOf(pick) + "）";
  }

  // 1つなら「🈷️ 漢字（中学）」、複数なら「🈷️🔤 ミックス（3種類）」
  function describe(rules) {
    var picks = normalizeRules(rules).picks;
    if (!picks.length) {
      return "問題を選んでいません";
    }
    if (picks.length === 1) {
      return describePick(picks[0]);
    }
    var icons = [];
    picks.forEach(function (pick) {
      var icon = findGenre(pick.genre).icon;
      if (icons.indexOf(icon) === -1) {
        icons.push(icon);
      }
    });
    return icons.join("") + " ミックス（" + picks.length + "種類）";
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
  var poolCache = {};

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
    // JSON の問題も "tex"（$…$ の中が TeX）を書けば数式で組む
    return { text: item.q, tex: typeof item.tex === "string" ? item.tex : "", choices: built.choices, answer: built.answer, mark: item.m || Array.from(item.q)[0] };
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

  function signedTex(value) {
    return value < 0 ? "- " + -value : "+ " + value;
  }

  // それぞれ { text, answer, wrongs, mark, tex }。mark は盤面に出す記号。
  // tex は数式として組むときの問題文（$…$ の中が TeX）。読み込めないときは text をそのまま出す
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
        return { text: a + "x " + signed(b) + " = " + (a * x + b) + " のとき x = ?", answer: x, wrongs: [x + 1, x - 1, -x === x ? x + 2 : -x], mark: "x",
          tex: "$" + a + "x " + signedTex(b) + " = " + (a * x + b) + "$ のとき $x = ?$" };
      }
      if (kind === 1) {
        a = randomInt(random, 11, 25);
        return { text: "√" + a * a + " = ?", answer: a, wrongs: [a + 1, a - 1, a + 2], mark: "√", tex: "$\\sqrt{" + a * a + "} = ?$" };
      }
      a = randomInt(random, 1, 9); b = randomInt(random, 1, 9);
      return { text: "(x + " + a + ")(x + " + b + ") を展開したときの x の係数は？", answer: a + b, wrongs: [a * b, a + b + 1, Math.abs(a - b) === a + b ? a + b + 2 : Math.abs(a - b)], mark: "(",
        tex: "$(x + " + a + ")(x + " + b + ")$ を展開したときの $x$ の係数は？" };
    },
    // 高校：微分係数・定積分
    h: function (random) {
      var kind = randomInt(random, 0, 1);
      var a = randomInt(random, 1, 5);
      var b = randomInt(random, -6, 6);
      var k = randomInt(random, 1, 4);
      if (kind === 0) {
        var answer = 2 * a * k + b;
        // b = 0 のときは「+ 0x」を書かない
        return { text: "f(x) = " + (a === 1 ? "" : a) + "x²" + (b ? " " + signed(b) + "x" : "") + " のとき f′(" + k + ") = ?", answer: answer, wrongs: [a * k * k + b * k, answer + 2, 2 * a * k], mark: "f",
          tex: "$f(x) = " + (a === 1 ? "" : a) + "x^2" + (b ? " " + signedTex(b) + "x" : "") + "$ のとき $f'(" + k + ") = ?$" };
      }
      // ∫₀ᵏ (2a·x + b) dx = a·k² + b·k
      var value = a * k * k + b * k;
      return { text: "∫₀^" + k + " (" + 2 * a + "x" + (b ? " " + signed(b) : "") + ") dx = ?", answer: value, wrongs: [2 * a * k + b, value + k, value - k], mark: "∫",
        tex: "$\\displaystyle\\int_0^{" + k + "} (" + 2 * a + "x" + (b ? " " + signedTex(b) : "") + ")\\,dx = ?$" };
    },
    // 大学：微分積分（8×8 の空きマス60でも重ならないよう、問題文が80通り以上になる幅にしている）
    u: function (random) {
      var kind = randomInt(random, 0, 4);
      var a;
      var n;
      var k;
      if (kind === 0) {
        a = randomInt(random, 2, 15);
        return { text: "d/dx e^(" + a + "x) の x = 0 での値は？", answer: a, wrongs: [1, a * a, a + 1], mark: "e",
          tex: "$\\dfrac{d}{dx} e^{" + a + "x}$ の $x = 0$ での値は？" };
      }
      if (kind === 1) {
        n = randomInt(random, 2, 15);
        return { text: "∫₀¹ x^" + n + " dx = ?", answer: fraction(1, n + 1), wrongs: [fraction(1, n), fraction(n, n + 1), fraction(1, n + 2)], mark: "∫",
          tex: "$\\displaystyle\\int_0^1 x^{" + n + "}\\,dx = ?$" };
      }
      if (kind === 2) {
        a = randomInt(random, 2, 20);
        return { text: "lim(x→0) sin(" + a + "x) / x = ?", answer: a, wrongs: [1, 0, fraction(1, a)], mark: "→",
          tex: "$\\displaystyle\\lim_{x \\to 0} \\frac{\\sin " + a + "x}{x} = ?$" };
      }
      if (kind === 3) {
        // d/dx x^n の x = k での値 = n·k^(n−1)
        n = randomInt(random, 2, 6); k = randomInt(random, 1, 4);
        var value = n * Math.pow(k, n - 1);
        return { text: "d/dx (x^" + n + ") の x = " + k + " での値は？", answer: value, wrongs: [Math.pow(k, n), n * Math.pow(k, n), (n - 1) * Math.pow(k, n - 1)], mark: "d",
          tex: "$\\dfrac{d}{dx} x^{" + n + "}$ の $x = " + k + "$ での値は？" };
      }
      // d/dx log x の x = k での値 = 1/k
      k = randomInt(random, 2, 15);
      return { text: "d/dx (log x) の x = " + k + " での値は？", answer: fraction(1, k), wrongs: [String(k), fraction(1, k * k), fraction(1, k + 1)], mark: "ℓ",
        tex: "$\\dfrac{d}{dx} \\log x$ の $x = " + k + "$ での値は？" };
    }
  };

  function fromMath(random, level) {
    var made = (MATH[level] || MATH.e)(random);
    var built = buildChoices(random, made.answer, made.wrongs);
    // 分数の答え（1/3 など）は、数式として組めるときは縦の分数で見せる
    return { text: made.text, tex: made.tex || "", choices: built.choices, answer: built.answer, mark: made.mark, texChoices: true };
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

  // 数学：その組み合わせで重ならない問題を count 問、種から順に作っておく
  var mathLists = {};

  function mathList(seed, level, count) {
    var key = [seed, level, count].join(":");
    if (mathLists[key]) {
      return mathLists[key];
    }
    var used = {};
    var list = [];
    var index;
    var salt;
    var question;
    for (index = 0; index < count; index += 1) {
      for (salt = 0; salt < 200; salt += 1) {
        question = fromMath(createRandom(hashString([seed, "math", level, index, salt].join(":"))), level);
        if (!used[question.text]) {
          break;
        }
      }
      used[question.text] = true;
      list.push(question);
    }
    mathLists[key] = list;
    return list;
  }

  var MATH_POOL_SIZE = 64;

  // 選んだ組み合わせの問題をすべて1つの山にし、種で並べ替える
  function buildPool(rules) {
    var key = [rules.seed, rules.picks.map(pickKey).join(",")].join("|");
    if (poolCache[key]) {
      return poolCache[key];
    }
    var entries = [];
    rules.picks.forEach(function (pick) {
      if (pick.genre === "math") {
        mathList(rules.seed, pick.level, MATH_POOL_SIZE).forEach(function (question) {
          entries.push({ pick: pick, math: question });
        });
        return;
      }
      var bank = levelOf(pick).items || [];
      bank.forEach(function (item, itemIndex) {
        entries.push({ pick: pick, itemIndex: itemIndex });
      });
    });
    poolCache[key] = {
      entries: entries,
      order: permutation(entries.length, hashString([key, "order"].join(":")))
    };
    return poolCache[key];
  }

  // マスの問題。attempt はそのマスで何回目の挑戦か（不正解のあとは別の問題になる）
  //   最初は山の前から空きマスに1つずつ、不正解のあとは盤面で使わなかった残りから出す
  //   position：不正解のあとに割り当てた山の位置（nextRetryPosition）。ない古い記録は従来の計算で選ぶ
  function questionFor(rules, row, col, attempt, position) {
    var normalized = normalizeRules(rules);
    var tries = attempt || 0;
    var size = normalized.size;
    var cellCount = size * size - 4;
    var index = cellIndex(size, row, col);
    var pool = buildPool(normalized);
    var total = pool.entries.length;
    if (!total) {
      return { text: "", tex: "", choices: [], answer: 0, mark: "", genre: "", pick: null, pickLabel: "" };
    }
    if (tries === 0) {
      position = index;
    } else if (typeof position !== "number") {
      position = cellCount + (index * 7 + tries * 13) % Math.max(1, total - cellCount);
    }
    var entry = pool.entries[pool.order[position % total]];
    var pick = entry.pick;
    var random = createRandom(hashString([normalized.seed, pickKey(pick), row, col, tries].join(":")));
    var question;

    if (entry.math) {
      question = entry.math;
    } else {
      var level = levelOf(pick);
      var bank = level.items;
      if (level.type === "choices") {
        question = fromAuthored(random, bank[entry.itemIndex]);
      } else {
        var marks = level.mark === "first-letter" ?
          bank.map(function (pair) { return pair[0].charAt(0).toUpperCase(); }) :
          distinctiveMarks(pickKey(pick), bank.map(function (pair) { return pair[0]; }));
        // まちがいの選択肢は同じジャンル・レベルの中から選ぶ（混ぜても不自然にならない）
        question = fromPair(random, bank, entry.itemIndex, level.template, marks[entry.itemIndex]);
      }
    }
    return Object.assign({}, question, { genre: pick.genre, pick: pick, pickLabel: describePick(pick) });
  }

  // 盤面に出す1文字
  function markFor(rules, row, col, attempt, position) {
    return questionFor(rules, row, col, attempt, position).mark || "";
  }

  // そのマスでいま出す問題の山の位置（retries[マス] = 不正解のたびに割り当てた位置の列）
  function currentPosition(rules, retries, row, col) {
    var list = (retries || {})[row + "-" + col] || [];
    return list.length ? list[list.length - 1] : cellIndex(normalizeRules(rules).size, row, col);
  }

  // 対局の記録（マスごとの挑戦回数 attempts・不正解のあとに割り当てた位置 retries）から、そのマスのいまの問題
  function questionAt(rules, attempts, retries, row, col) {
    var key = row + "-" + col;
    var attempt = (attempts || {})[key] || 0;
    var list = (retries || {})[key] || [];
    return questionFor(rules, row, col, attempt, attempt && list.length === attempt ? list[attempt - 1] : undefined);
  }

  // 不正解のあと、そのマスで次に出す問題の山の位置を決める（両方の端末で同じ結果になる）
  //   1. まだ一度も使っていない問題（空きマスの最初の問題のあと）を順番に使う → 盤面の中で重ならない
  //   2. 使い切ったら、いま空きマスに出ていない問題（石が置かれたマスの問題など）から選ぶ。
  //      問題の数が少ないと同じ問題がまた出ることはあるが、空いているマスどうしで重なることはない
  function nextRetryPosition(rules, board, retries) {
    var normalized = normalizeRules(rules);
    var size = normalized.size;
    var cellCount = size * size - 4;
    var total = buildPool(normalized).entries.length;
    var used = 0;
    Object.keys(retries || {}).forEach(function (key) { used += (retries[key] || []).length; });
    if (cellCount + used < total) {
      return cellCount + used;
    }
    var mid = size / 2;
    var showing = {};
    var row;
    var col;
    for (row = 0; row < size; row += 1) {
      for (col = 0; col < size; col += 1) {
        if ((row === mid - 1 || row === mid) && (col === mid - 1 || col === mid)) {
          continue;
        }
        if (!board[row][col]) {
          showing[currentPosition(normalized, retries, row, col) % total] = true;
        }
      }
    }
    var free = [];
    var position;
    for (position = 0; position < total; position += 1) {
      if (!showing[position]) {
        free.push(position);
      }
    }
    if (!free.length) {
      return cellCount + used;
    }
    return free[hashString([normalized.seed, "retry", used].join(":")) % free.length];
  }

  function newSeed() {
    return (Math.floor(Math.random() * 4294967295) >>> 0) || 1;
  }

  // COM が正解する確率（その問題のレベルが上がるほど少し下がる）
  function comAccuracy(pick) {
    var genre = findGenre(pick && pick.genre);
    var index = 0;
    genre.levels.forEach(function (level, i) {
      if (pick && level.id === pick.level) {
        index = i;
      }
    });
    return Math.max(0.5, 0.8 - index * 0.08);
  }

  window.OthelloQuiz = {
    GENRES: GENRES,
    load: load,
    isReady: isReady,
    LIFE_CHOICES: LIFE_CHOICES,
    TIME_CHOICES: TIME_CHOICES,
    currentPosition: currentPosition,
    questionAt: questionAt,
    nextRetryPosition: nextRetryPosition,
    isLoaded: function () { return loaded; },
    findGenre: findGenre,
    normalizeRules: normalizeRules,
    describe: describe,
    describePick: describePick,
    pickKey: pickKey,
    togglePick: togglePick,
    hasPick: hasPick,
    questionFor: questionFor,
    markFor: markFor,
    newSeed: newSeed,
    comAccuracy: comAccuracy
  };
}(window));
