// 数式の組版（OthelloTex。KaTeX）：数式の問題が出たときだけ読みこみ、読めるまで・読めないときはふつうの文字で出す。
// ui.js が問題を描くときに使う
(function (window, document) {
  // 数式の組版（KaTeX）。数式の問題が出たときだけ読み込み、読み込めるまで・読み込めないときは普通の文字で出す
  var KATEX_VERSION = "0.16.11";
  var BASE = "https://cdn.jsdelivr.net/npm/katex@" + KATEX_VERSION + "/dist/";
  var state = "idle"; // idle → loading → ready / failed
  var listeners = [];

  // KaTeX が使えるか
  function isReady() {
    return state === "ready" && !!window.katex;
  }

  // KaTeX を読みこむ（1回だけ）。読めたら描きなおしを知らせる
  function load() {
    if (state !== "idle") {
      return;
    }
    state = "loading";
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = BASE + "katex.min.css";
    document.head.appendChild(link);
    var script = document.createElement("script");
    script.src = BASE + "katex.min.js";
    script.async = true;
    script.onload = function () {
      state = window.katex ? "ready" : "failed";
      listeners.splice(0).forEach(function (listener) { listener(); });
    };
    script.onerror = function () {
      state = "failed";
      listeners.length = 0;
    };
    document.head.appendChild(script);
  }

  // 読み込みが終わったら一度だけ呼ぶ（画面を組み直す用）
  function onReady(listener) {
    if (isReady()) {
      return;
    }
    if (listeners.indexOf(listener) === -1) {
      listeners.push(listener);
    }
    load();
  }

  // 文字を HTML に入れても、タグとして動かない形にする
  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch];
    });
  }

  // $…$ の中を数式、外をふつうの文字にした HTML
  function toHtml(tex) {
    // $…$ の中を数式、外を普通の文字として並べる
    return String(tex).split("$").map(function (part, index) {
      if (index % 2 === 0) {
        return escapeHtml(part);
      }
      return window.katex.renderToString(part, { throwOnError: false, output: "html" });
    }).join("");
  }

  // 問題文：tex があれば数式で、なければ text を出す
  function setText(element, text, tex, rerender) {
    if (tex && isReady()) {
      try {
        element.innerHTML = toHtml(tex);
        return;
      } catch (error) {
        // 組めないときは普通の文字に戻す
      }
    }
    element.textContent = text;
    if (tex && rerender) {
      onReady(rerender);
    }
  }

  // 選択肢：分数（1/3 や -2/5）だけ縦の分数にする
  function setChoice(element, text, useTex) {
    var match = useTex && isReady() && /^(-?)(\d+)\/(\d+)$/.exec(String(text));
    if (match) {
      element.innerHTML = window.katex.renderToString(match[1] + "\\frac{" + match[2] + "}{" + match[3] + "}", { throwOnError: false });
      element.setAttribute("aria-label", text);
      return;
    }
    element.textContent = text;
  }

  window.OthelloTex = {
    escapeHtml: escapeHtml,
    load: load,
    isReady: isReady,
    onReady: onReady,
    setText: setText,
    setChoice: setChoice
  };
}(window, document));
