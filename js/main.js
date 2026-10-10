(function (window, document) {
  document.addEventListener("DOMContentLoaded", function () {
    // 問題（questions/*.json）を読み込んでから始める。読み込めなくても数学だけで遊べる
    window.OthelloQuiz.load().then(function () {
      window.OthelloSession.create().bootstrap();
    });
  });
}(window, document));
