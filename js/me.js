// 見出しの本人のアイコン（OthelloMe）：ロゴの右に、本人の LINE のアイコン（なければ名前の頭の字）を出す。
// 出すのは Q キットの shared/line-me.js（window.QLineMe。つづく・しょくじ・キロっくと同じ見た目）。緑のふちはログイン中、灰色はまだ（ゲスト）。
// 押したとき：ブラウザ版のゲストなら、はじめに出した「LINE 版で開く／ログインして遊ぶ」のシート（platform.js）。
// ログイン中なら、だれでログインしているか・対戦相手に見えるもの・版のシート（ここ）。
// ひっくりはボットにつながないので bot: false。LIFF は platform.js が起こしたものを待つ（2回起こさない）。
// app.js の start から mount を呼ぶ
(function (window, document) {
  // せまい画面では版の札をアイコンのシートに移すための印（css/page.css の .has-me）
  var HOST_CLASS = "has-me";

  // シートの行（文字だけ。テストで中身を確かめる）。st：{ me（{ name, picture } か null）, loggedIn, version }
  function rows(st) {
    var s = st || {};
    var name = s.me && s.me.name ? s.me.name : "";
    var list = [];
    if (s.loggedIn) {
      list.push({ icon: "✅", text: (name ? name + " さん" : "LINE") + "でログインしています" });
      list.push({ icon: "👥", text: "友だちとの対戦では、相手にこの名前とアイコンが見えます" });
    } else {
      list.push({ icon: "👤", text: "まだ LINE にログインしていません。COM との練習と 1台で2人は、このまま遊べます" });
    }
    if (s.version) {
      list.push({ icon: "🏷️", text: "版 " + s.version });
    }
    return list;
  }

  // アイコン（画像か頭の字）。名前・URL は文字として入れる（HTML にしない）
  function avatarEl(me) {
    var box = document.createElement("span");
    box.className = "qme-avatar";
    box.setAttribute("aria-hidden", "true");
    var name = me && me.name ? String(me.name) : "";
    // 頭の字は、見出しのアイコンと同じ、名前で決まる色の丸（Q キットの hue）
    function showInitial() {
      box.replaceChildren(document.createTextNode(window.QLineMe.initial(name)));
      if (name.trim() && typeof window.QLineMe.hue === "function") {
        box.classList.add("is-initial");
        box.style.setProperty("--qme-h", String(window.QLineMe.hue(name)));
      }
    }
    if (me && me.picture) {
      var img = document.createElement("img");
      img.src = me.picture;
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", showInitial);
      box.appendChild(img);
    } else {
      showInitial();
    }
    return box;
  }

  // ログイン中（か、手元で試すとき）のシート。閉じるで消す
  function openSheet(handle, button) {
    if (document.querySelector(".me-sheet")) {
      return;
    }
    var st = handle.status();
    var badge = document.getElementById("versionBadge");
    var version = badge ? String(badge.textContent || "").trim() : "";
    var sheet = document.createElement("div");
    sheet.className = "ls-sheet me-sheet";
    var card = document.createElement("div");
    card.className = "ls-sheet-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "meSheetTitle");
    var head = document.createElement("div");
    head.className = "qme-head" + (st.loggedIn ? "" : " is-out");
    var title = document.createElement("p");
    title.className = "ls-sheet-title";
    title.id = "meSheetTitle";
    title.textContent = st.loggedIn && st.me && st.me.name ? st.me.name + " さん" : "ひっくり";
    head.append(avatarEl(st.me), title);
    var list = document.createElement("ul");
    list.className = "qme-rows";
    rows({ me: st.me, loggedIn: st.loggedIn, version: version && version !== "----" ? version : "" }).forEach(function (row) {
      var li = document.createElement("li");
      var icon = document.createElement("span");
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = row.icon;
      var text = document.createElement("span");
      text.textContent = row.text;
      li.append(icon, text);
      list.appendChild(li);
    });
    var cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ls-sheet-cancel";
    cancel.textContent = "閉じる";
    card.append(head, list, cancel);
    sheet.appendChild(card);

    // 閉じて、アイコンに戻る
    function close() {
      sheet.remove();
      document.removeEventListener("keydown", onKey);
      if (button) {
        button.focus({ preventScroll: true });
      }
    }
    // Esc で閉じる
    function onKey(event) {
      if (event.key === "Escape") {
        close();
      }
    }
    cancel.addEventListener("click", close);
    sheet.addEventListener("click", function (event) {
      if (event.target === sheet) {
        close();
      }
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(sheet);
    cancel.focus({ preventScroll: true });
  }

  // 見出しにアイコンを出す（Q キットが読めないとき・LIFF ID がないときは何もしない）
  function mount() {
    var Platform = window.OthelloPlatform;
    var liffId = window.APP_CONFIG && window.APP_CONFIG.liffId;
    if (!window.QLineMe || !Platform || !liffId) {
      return null;
    }
    var host = document.querySelector(".ls-brand");
    var handle = window.QLineMe.mount({
      liffId: liffId,
      host: host,
      // ブラウザ版でも出す（ゲストは灰色のふち。押すとログインの案内）
      show: true,
      bot: false,
      ready: Platform.liffReady(),
      onOpen: function (h) {
        var st = h.status();
        if (!st.loggedIn && Platform.isOutsideGuest()) {
          Platform.showOutsideChoice(null);
          return;
        }
        openSheet(h, host ? host.querySelector(".qme-button") : null);
      }
    });
    if (handle && host) {
      host.classList.add(HOST_CLASS);
    }
    return handle;
  }

  window.OthelloMe = { mount: mount, rows: rows };
}(window, document));
