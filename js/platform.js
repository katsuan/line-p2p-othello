// LINE（LIFF）とブラウザのつなぎ（OthelloPlatform）：本人・ルームの URL・招待と結果を送る・コピー・版・開きなおし。
// session.js・ui.js から使う。送るカードの中身は js/card.js
(function (window, document) {
  var identityPromise = null;

  // 推測されにくい ID（ルーム ID など。英小文字と数字12文字）
  function generateId(prefix) {
    var chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    var bytes = new Uint8Array(12);
    var text = "";
    var index;
    window.crypto.getRandomValues(bytes);
    for (index = 0; index < bytes.length; index += 1) {
      text += chars.charAt(bytes[index] % chars.length);
    }
    return prefix + "-" + text;
  }

  // ルームに書く本人の印：ユーザー ID の SHA-256 の先頭32文字（元の ID には戻せない）
  function hashUserId(userId) {
    var text = "hiqri:" + String(userId || "");
    if (!window.crypto || !window.crypto.subtle || !window.TextEncoder) {
      return Promise.resolve(sanitizeForPeer(userId));
    }
    return window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (buffer) {
      return "u" + Array.prototype.map.call(new Uint8Array(buffer), function (byte) {
        return ("0" + byte.toString(16)).slice(-2);
      }).join("").slice(0, 32);
    }).catch(function () {
      return sanitizeForPeer(userId);
    });
  }

  // PeerJS の ID に使える文字だけにする
  function sanitizeForPeer(value) {
    return String(value || "player").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 28) || "player";
  }

  // URL のパスを「…/」で終わる形にそろえる
  function normalizePathname(pathname) {
    var value = pathname || "/";
    var lastSegment = value.split("/").pop();

    if (value.charAt(0) !== "/") {
      value = "/" + value;
    }
    if (value.charAt(value.length - 1) !== "/" && lastSegment.indexOf(".") === -1) {
      value += "/";
    }
    return value;
  }

  // このページの URL（? より前）
  function getAppBaseUrl() {
    return window.location.origin + normalizePathname(window.location.pathname);
  }

  // ひっくりのファイルが置いてある場所（js/ の1つ上）
  function getStaticRootUrl() {
    var script =
      document.querySelector('script[src*="/js/platform.js"]') ||
      document.querySelector('script[src$="js/platform.js"]') ||
      document.querySelector('script[src*="/js/card.js"]');

    if (script && script.src) {
      return String(new URL("../", script.src));
    }

    return getAppBaseUrl();
  }

  // ひっくりのファイル（画像・version.json など）の URL
  function getAssetUrl(filename) {
    return String(new URL(filename, getStaticRootUrl()));
  }

  // 手元で試しているか（file:・localhost など）
  function isLocalPreviewEnvironment() {
    var hostname = String(window.location.hostname || "").toLowerCase();
    var params = new URLSearchParams(window.location.search);

    return window.location.protocol === "file:" ||
      hostname === "127.0.0.1" ||
      hostname === "localhost" ||
      hostname === "0.0.0.0" ||
      params.get("vscode-livepreview") === "true";
  }

  // そのルームを LINE 版で開く URL（LIFF ID がなければ空）
  function buildLiffRoomUrl(roomId) {
    if (!window.APP_CONFIG || !window.APP_CONFIG.liffId || window.APP_CONFIG.liffId === "YOUR_LIFF_ID" || !roomId) {
      return "";
    }
    return "https://liff.line.me/" + window.APP_CONFIG.liffId + "?room=" + encodeURIComponent(roomId);
  }

  // 手元で試すときの仮の ID（この端末に残して、毎回同じにする）
  function getStableDebugUserId() {
    var storageKey = "liff-p2p-debug-user-id";
    var existingId = "";

    try {
      existingId = window.localStorage.getItem(storageKey) || "";
      if (!existingId) {
        existingId = generateId("debug-user");
        window.localStorage.setItem(storageKey, existingId);
      }
    } catch (error) {
      existingId = generateId("debug-user");
    }

    return existingId;
  }

  // 本人（userId・名前・アイコン）を決めて返す。LINE 版なら LIFF から、ブラウザ版ならログインするか選んでもらう。1回だけ動く
  function initIdentity() {
    if (identityPromise) {
      return identityPromise;
    }

    identityPromise = new Promise(function (resolve, reject) {
      if (isLocalPreviewEnvironment() ||
          !window.liff ||
          !window.APP_CONFIG.liffId ||
          window.APP_CONFIG.liffId === "YOUR_LIFF_ID") {
        resolve({
          userId: getStableDebugUserId(),
          displayName: "デバッグユーザー",
          pictureUrl: ""
        });
        return;
      }

      liff.init({
        liffId: window.APP_CONFIG.liffId
      }).then(function () {
        if (!liff.isLoggedIn()) {
          if (typeof liff.login === "function") {
            // ブラウザ版では、黙ってログイン画面へ飛ばさず、ログインするか LINE 版で開くかを選んでもらう
            if (typeof liff.isInClient === "function" && !liff.isInClient()) {
              showOutsideChoice(function () {
                resolve({ userId: getStableDebugUserId(), displayName: "ゲスト", pictureUrl: "", guest: true });
              });
              return;
            }
            // ログイン後は今のページ（?room= 付き）に戻す。指定しないと LIFF の入口に戻り、招待されたルームに入れない
            liff.login({ redirectUri: loginReturnUrl() });
            return;
          }
          reject(new Error("LINE にログインできませんでした。"));
          return;
        }

        liff.getProfile().then(function (profile) {
          resolve({
            userId: profile.userId,
            displayName: profile.displayName || "LINE ユーザー",
            pictureUrl: profile.pictureUrl || ""
          });
        }).catch(function () {
          resolve({
            userId: getStableDebugUserId(),
            displayName: "LINE ユーザー",
            pictureUrl: ""
          });
        });
      }).catch(function () {
        resolve({
          userId: getStableDebugUserId(),
          displayName: "デバッグユーザー",
          pictureUrl: ""
        });
      });
    });

    return identityPromise;
  }

  // 公開中の版（version.json）を読む。読めなければ空
  function loadVersionInfo() {
    return fetch(getAssetUrl("version.json") + "?t=" + Date.now(), {
      cache: "no-store"
    }).then(function (response) {
      if (!response.ok) {
        throw new Error("version.json を取得できませんでした。");
      }
      return response.json();
    }).then(function (payload) {
      if (payload && payload.version) {
        return payload.version;
      }
      throw new Error("version.json の形式が不正です。");
    }).catch(function () {
      return window.APP_CONFIG && window.APP_CONFIG.appVersion ? window.APP_CONFIG.appVersion : "";
    });
  }

  // 文字をコピーする。できたら true
  function copyText(text) {
    var textarea;

    if (!text) {
      return Promise.resolve(false);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () {
        return true;
      }).catch(function () {
        return false;
      });
    }

    textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "readonly");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    return Promise.resolve(true);
  }

  // 招待に入れるルームの URL（LINE 版の URL があればそれ）
  function buildShareUrl(roomId, url) {
    var directLiffUrl = buildLiffRoomUrl(roomId);

    if (directLiffUrl) {
      return Promise.resolve(directLiffUrl);
    }

    if (!url) {
      return Promise.resolve("");
    }

    if (!window.liff || !liff.permanentLink || typeof liff.permanentLink.createUrlBy !== "function") {
      return Promise.resolve(url);
    }

    try {
      return Promise.resolve(liff.permanentLink.createUrlBy(url)).catch(function () {
        return url;
      });
    } catch (error) {
      return Promise.resolve(url);
    }
  }

  // ブラウザ版で開いたとき：「LINE 版で開く」「ログインして遊ぶ」か、ログインせずに COM・1台で2人で遊ぶかを選ぶ（キロっく・おくるんと同じ考え方）。
  // LINE 版で開くときは、招待されたルーム（?room=）もそのまま持っていく
  function showOutsideChoice(playAsGuest) {
    var appUrl = "https://liff.line.me/" + window.APP_CONFIG.liffId + window.location.search;
    var box = document.createElement("div");
    box.className = "ls-sheet outside-choice";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-labelledby", "outsideChoiceTitle");
    box.innerHTML =
      '<div class="ls-sheet-card outside-choice-card">' +
      '<img src="' + getAssetUrl("assets/icon.svg") + '" alt="" width="56" height="56">' +
      '<p id="outsideChoiceTitle" class="ls-sheet-title">ブラウザ版で開いています</p>' +
      '<p class="ls-hint outside-choice-text">友だちとの対戦は、下のどちらかで遊べます。COM との練習は、このまま遊べます。</p>' +
      '<a class="ls-outside-button is-app outside-choice-button" data-act="app">💬 LINE 版で開く</a>' +
      '<button class="ls-outside-button outside-choice-button" type="button" data-act="login">🔑 ログインして遊ぶ</button>' +
      '<button class="ls-sheet-cancel" type="button" data-act="guest">🤖 ログインせずに練習する</button>' +
      "</div>";
    box.querySelector('[data-act="app"]').setAttribute("href", appUrl);
    box.querySelector('[data-act="login"]').addEventListener("click", function () {
      liff.login({ redirectUri: loginReturnUrl() });
    });
    box.querySelector('[data-act="guest"]').addEventListener("click", function () {
      box.remove();
      playAsGuest();
    });
    document.body.appendChild(box);
  }

  // ログインの受け渡しで付く一時的なパラメータは外す（おくるんの shared/liff.js と同じ）
  function loginReturnUrl() {
    var url = new URL(window.location.href);
    ["code", "state", "liffClientId", "liffRedirectUri", "error", "error_description", "friendship_status_changed"].forEach(function (key) {
      url.searchParams.delete(key);
    });
    return url.toString();
  }

  // LINE の送り先を選ぶ画面が使えるか（LIFF の準備前は isApiAvailable が例外を出すので、使えないあつかい）
  function canPickTarget() {
    try {
      return !!(window.liff &&
        typeof liff.isApiAvailable === "function" &&
        liff.isApiAvailable("shareTargetPicker") &&
        typeof liff.shareTargetPicker === "function");
    } catch (error) {
      return false;
    }
  }

  // コピーできないときは、選べる文字をシートで出す（ブラウザの小窓は使わない）
  function showCopyBox(title, text) {
    if (window.LineShareUI && typeof window.LineShareUI.ask === "function") {
      window.LineShareUI.ask({ title: title, input: text, readonly: true, ok: "閉じる", cancel: null });
    }
  }

  // LINE で送れないときはコピー。コピーもできないときは選べる文字で出す
  function copyInstead(text, copiedMessage, boxTitle) {
    return copyText(text).then(function (copied) {
      if (copied) {
        return { status: "copied", message: copiedMessage };
      }
      showCopyBox(boxTitle, text);
      return { status: "manual", message: "" };
    });
  }

  // 季節の絵文字（Q キットの season.js。まだ読めていなければ付けない）。うれしい瞬間の短い文だけに
  function withSeason(text) {
    return window.QSeason && typeof window.QSeason.decorate === "function" ? window.QSeason.decorate(text) : text;
  }

  // 対局の結果をカードで送る（ブラウザ版・送れないときはコピー）。返すもの：{ status, message }
  function shareResult(info) {
    var text = "ひっくりの結果：" + info.myName + " " + info.mine + " - " + info.theirs + " " + info.opponentName;
    if (canPickTarget()) {
      return liff.shareTargetPicker([window.OthelloCard.result(info)]).then(function (result) {
        return { status: result ? "shared" : "cancelled", message: result ? withSeason("結果を送りました。") : "送るのをやめました。" };
      }).catch(function (error) {
        if (window.console) {
          window.console.warn("[ひっくり] 結果を送れませんでした", error);
        }
        return copyInstead(text, "送れなかったので、結果をコピーしました。", "結果を長押ししてコピーしてね");
      });
    }
    return copyInstead(text, "ブラウザ版なので、結果をコピーしました。トークに貼って送れます。", "結果を長押ししてコピーしてね");
  }

  // 招待をカードで送る（ブラウザ版・送れないときはリンクをコピー）。返すもの：{ status, message }
  function shareRoom(roomId, url) {
    return buildShareUrl(roomId, url).then(function (shareUrl) {
      if (canPickTarget()) {
        return liff.shareTargetPicker([
          window.OthelloCard.invite(roomId, shareUrl)
        ]).then(function (result) {
          if (result) {
            return { status: "shared", message: withSeason("招待を送りました。友だちの参加を待っています。") };
          }
          return { status: "cancelled", message: "招待を送るのをやめました。" };
        }).catch(function (error) {
          if (window.console) {
            window.console.warn("[ひっくり] 招待を送れませんでした", error);
          }
          return copyInstead(shareUrl, "送れなかったので、招待のリンクをコピーしました。", "招待のリンクを長押ししてコピーしてね");
        });
      }

      return copyInstead(shareUrl, "ブラウザ版なので、招待のリンクをコピーしました。トークに貼って送れます。", "招待のリンクを長押ししてコピーしてね");
    });
  }

  // この端末に残したひっくりの記録を消す（開きなおすとき）
  function clearAppStorage() {
    var index;
    var key;
    var keys = [];

    try {
      for (index = 0; index < window.localStorage.length; index += 1) {
        key = window.localStorage.key(index);
        if (key && key.indexOf("liff-p2p") === 0) {
          keys.push(key);
        }
      }
      for (index = 0; index < keys.length; index += 1) {
        window.localStorage.removeItem(keys[index]);
      }
    } catch (error) {}

    try {
      window.sessionStorage.clear();
    } catch (error2) {}
  }

  // URL を開きなおす（clearStorage なら記録を消してから）
  function reload(url, clearStorage) {
    if (clearStorage) {
      clearAppStorage();
    }
    window.location.href = url || window.location.href;
  }

  window.OthelloPlatform = {
    withSeason: withSeason,
    generateId: generateId,
    sanitizeForPeer: sanitizeForPeer,
    hashUserId: hashUserId,
    getAppBaseUrl: getAppBaseUrl,
    getAssetUrl: getAssetUrl,
    buildLiffRoomUrl: buildLiffRoomUrl,
    initIdentity: initIdentity,
    loadVersionInfo: loadVersionInfo,
    copyText: copyText,
    showCopyBox: showCopyBox,
    shareRoom: shareRoom,
    shareResult: shareResult,
    reload: reload
  };
}(window, document));
