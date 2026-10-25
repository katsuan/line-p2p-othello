// 前の名前のファイル。入口は app.js に、送るカードは js/card.js に移した（docs: README の「前の名前のファイル」）。
// 古い index.html を覚えている端末のために、新しいファイルを読むだけ。2026-11-25 ごろ消す
(function (document) {
  var base = document.currentScript ? document.currentScript.src : document.baseURI;
  var files = (window.OthelloCard ? [] : ["card.js"]).concat(["../app.js"]);
  (function next() {
    var file = files.shift();
    if (!file) return;
    var script = document.createElement("script");
    script.src = new URL(file, base).href;
    script.onload = next;
    document.head.appendChild(script);
  }());
}(document));
