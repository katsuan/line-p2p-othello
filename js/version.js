// 画面の右上に出す版（公開のとき scripts/update-version.sh がコミットの番号に書きかえる）。index.html が最初に読む
(function (window) {
  window.APP_CONFIG = window.APP_CONFIG || {};
  window.APP_CONFIG.appVersion = "ca81ef4";
}(window));
