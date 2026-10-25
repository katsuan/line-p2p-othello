// ひっくりの入口：使い方の案内を出し、問題を読んでから始める
(function (window, document) {
  function start() {
    // はじめて開いた人にだけ、短い使い方（Q キット。「わかった」で消え、この端末では二度と出さない）
    if (window.LineShareUI && typeof window.LineShareUI.firstTip === "function") {
      window.LineShareUI.firstTip("hiqri", [
        "置けるマスに点が出ます。押すと石が置けます",
        "📚 教養ルールでは、問題に正解すると置けます",
        "友だちを待つあいだは、COM と練習できます"
      ], document.querySelector(".board-layout"));
    }
    // 問題（questions/*.json）を読み込んでから始める。読み込めなくても数学だけで遊べる
    window.OthelloQuiz.load().then(function () {
      window.OthelloSession.create().bootstrap();
    });
  }

  // ふつうは HTML を読み終えたら始める。前の名前（js/main.js）からあとで読まれたときは、すぐ始める
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
}(window, document));
