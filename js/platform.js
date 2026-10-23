(function (window, document) {
  var identityPromise = null;

  // 推測されにくい ID（ルーム ID など）。英小文字と数字 12 文字
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

  // ルームに書く本人の印：ユーザー ID の SHA-256 の先頭 32 文字（元の ID には戻せない）
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

  function sanitizeForPeer(value) {
    return String(value || "player").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 28) || "player";
  }

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

  function getAppBaseUrl() {
    return window.location.origin + normalizePathname(window.location.pathname);
  }

  function getStaticRootUrl() {
    var script =
      document.querySelector('script[src*="/js/platform.js"]') ||
      document.querySelector('script[src$="js/platform.js"]') ||
      document.querySelector('script[src*="/js/main.js"]') ||
      document.querySelector('script[src$="js/main.js"]');

    if (script && script.src) {
      return String(new URL("../", script.src));
    }

    return getAppBaseUrl();
  }

  function getAssetUrl(filename) {
    return String(new URL(filename, getStaticRootUrl()));
  }

  function isLocalPreviewEnvironment() {
    var hostname = String(window.location.hostname || "").toLowerCase();
    var params = new URLSearchParams(window.location.search);

    return window.location.protocol === "file:" ||
      hostname === "127.0.0.1" ||
      hostname === "localhost" ||
      hostname === "0.0.0.0" ||
      params.get("vscode-livepreview") === "true";
  }

  function buildLiffRoomUrl(roomId) {
    if (!window.APP_CONFIG || !window.APP_CONFIG.liffId || window.APP_CONFIG.liffId === "YOUR_LIFF_ID" || !roomId) {
      return "";
    }
    return "https://liff.line.me/" + window.APP_CONFIG.liffId + "?room=" + encodeURIComponent(roomId);
  }

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
            // LINE の外（ブラウザ）では、黙ってログイン画面へ飛ばさず、ログインするか LINE アプリで開くかを選んでもらう
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

  // 招待カード：ロゴ・アイコンと同じ盤の緑。上にロゴ入りの画像（assets/ogp.png）、ボタンも緑
  var BRAND_GREEN = "#1F7A45";
  var BRAND_DARK = "#14542E";
  var SITE_URL = "https://katsuan.github.io/line-p2p-othello/";

  function buildFlexInviteMessage(roomId, shareUrl) {
    return {
      type: "flex",
      altText: "ひっくりの招待が届いています。ルームID: " + roomId,
      contents: {
        type: "bubble",
        size: "kilo",
        header: {
          type: "box",
          layout: "vertical",
          paddingAll: "14px",
          background: { type: "linearGradient", angle: "135deg", startColor: BRAND_GREEN, endColor: BRAND_DARK },
          contents: [
            { type: "text", text: "ひっくりで対戦しよう", weight: "bold", size: "lg", color: "#FFFFFF" },
            { type: "text", text: "〜HiQRi〜 LINE の友だちと石をひっくり返して対戦", size: "xxs", color: "#D8EEDF", margin: "xs", wrap: true }
          ]
        },
        hero: {
          type: "image",
          url: SITE_URL + "assets/ogp.png?v=20261019",
          size: "full",
          aspectRatio: "40:21",
          aspectMode: "cover",
          action: { type: "uri", uri: shareUrl }
        },
        body: {
          type: "box",
          layout: "vertical",
          spacing: "md",
          contents: [
            {
              type: "text",
              text: "このメッセージからルームに参加できます。",
              wrap: true,
              size: "sm",
              color: "#5B6E63"
            },
            // ルームIDの枠：上の行に「ルームID」とピル形の「コピー」、その下の行に ID
            {
              type: "box",
              layout: "vertical",
              paddingAll: "12px",
              backgroundColor: "#EAF5EE",
              cornerRadius: "14px",
              contents: [
                {
                  type: "box",
                  layout: "horizontal",
                  alignItems: "center",
                  spacing: "md",
                  contents: [
                    { type: "text", text: "ルームID", flex: 1, size: "xs", color: "#4C6B57" },
                    {
                      type: "box",
                      layout: "vertical",
                      flex: 0,
                      paddingTop: "4px",
                      paddingBottom: "4px",
                      paddingStart: "12px",
                      paddingEnd: "12px",
                      cornerRadius: "xxl",
                      backgroundColor: "#FFFFFF",
                      borderWidth: "1px",
                      borderColor: "#B9D9C4",
                      action: { type: "clipboard", label: "コピー", clipboardText: roomId },
                      contents: [{ type: "text", text: "📋 コピー", size: "xs", weight: "bold", color: BRAND_GREEN }]
                    }
                  ]
                },
                { type: "text", text: roomId, margin: "sm", weight: "bold", size: "lg", color: BRAND_DARK, wrap: true }
              ]
            }
          ]
        },
        footer: {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: [
            {
              type: "button",
              style: "primary",
              height: "sm",
              color: BRAND_GREEN,
              action: { type: "uri", label: "このルームに参加", uri: shareUrl }
            }
          ]
        }
      }
    };
  }

  // LINE の外で開いたとき：「LINE アプリで開く」「ログインして遊ぶ」か、ログインせずに COM・1台で2人で遊ぶかを選ぶ（キロっく・おくるんと同じ考え方）。
  // LINE アプリで開くときは、招待されたルーム（?room=）もそのまま持っていく
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
      '<p id="outsideChoiceTitle" class="ls-sheet-title">LINE の外で開いています</p>' +
      '<p class="ls-hint outside-choice-text">友だちとの対戦は、LINE で開くかログインすると遊べます。COM との練習は、このまま遊べます。</p>' +
      '<a class="ls-outside-button is-app outside-choice-button" data-act="app">💬 LINE アプリで開く</a>' +
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

  // 対局の結果のカード（招待カードと同じ緑）。ボタンは「ひっくりで対戦する」（LIFF の入口）
  function buildFlexResultMessage(info) {
    var title = info.outcome === "win" ? "🏆 勝ちました！" : info.outcome === "lose" ? "負けました…" : "引き分け";
    var appUrl = window.APP_CONFIG && window.APP_CONFIG.liffId ? "https://liff.line.me/" + window.APP_CONFIG.liffId : SITE_URL;
    var row = function (name, count, bold) {
      return {
        type: "box",
        layout: "horizontal",
        contents: [
          { type: "text", text: name, size: "sm", color: "#1D2A22", flex: 4, wrap: true, weight: bold ? "bold" : "regular" },
          { type: "text", text: count + " 個", size: "sm", color: "#1D2A22", align: "end", flex: 2, weight: bold ? "bold" : "regular" }
        ]
      };
    };
    return {
      type: "flex",
      altText: "ひっくりの結果：" + info.myName + " " + info.mine + " - " + info.theirs + " " + info.opponentName,
      contents: {
        type: "bubble",
        size: "kilo",
        header: {
          type: "box",
          layout: "vertical",
          paddingAll: "14px",
          background: { type: "linearGradient", angle: "135deg", startColor: BRAND_GREEN, endColor: BRAND_DARK },
          contents: [
            { type: "text", text: title, weight: "bold", size: "lg", color: "#FFFFFF" },
            { type: "text", text: "〜HiQRi〜 ひっくり返せ、その一手", size: "xxs", color: "#D8EEDF", margin: "xs" }
          ]
        },
        body: {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          paddingAll: "14px",
          contents: [
            { type: "text", text: info.mine + " - " + info.theirs, size: "3xl", weight: "bold", align: "center", color: BRAND_DARK },
            { type: "separator", margin: "md" },
            row(info.myName, info.mine, info.outcome === "win"),
            row(info.opponentName, info.theirs, info.outcome === "lose")
          ]
        },
        footer: {
          type: "box",
          layout: "vertical",
          paddingAll: "12px",
          contents: [
            { type: "button", style: "primary", color: BRAND_GREEN, height: "sm", action: { type: "uri", label: "ひっくりで対戦する", uri: appUrl } }
          ]
        }
      }
    };
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

  function shareResult(info) {
    var text = "ひっくりの結果：" + info.myName + " " + info.mine + " - " + info.theirs + " " + info.opponentName;
    if (canPickTarget()) {
      return liff.shareTargetPicker([buildFlexResultMessage(info)]).then(function (result) {
        return { status: result ? "shared" : "cancelled", message: result ? "結果を送りました。" : "送るのをやめました。" };
      }).catch(function (error) {
        if (window.console) {
          window.console.warn("[ひっくり] 結果を送れませんでした", error);
        }
        return copyInstead(text, "LINE で送れなかったので、結果をコピーしました。", "結果を長押ししてコピーしてね");
      });
    }
    return copyInstead(text, "LINE の外なので、結果をコピーしました。トークに貼って送れます。", "結果を長押ししてコピーしてね");
  }

  function shareRoom(roomId, url) {
    return buildShareUrl(roomId, url).then(function (shareUrl) {
      if (canPickTarget()) {
        return liff.shareTargetPicker([
          buildFlexInviteMessage(roomId, shareUrl)
        ]).then(function (result) {
          if (result) {
            return { status: "shared", message: "招待を送りました。友だちの参加を待っています。" };
          }
          return { status: "cancelled", message: "招待を送るのをやめました。" };
        }).catch(function (error) {
          if (window.console) {
            window.console.warn("[ひっくり] 招待を送れませんでした", error);
          }
          return copyInstead(shareUrl, "LINE で送れなかったので、招待のリンクをコピーしました。", "招待のリンクを長押ししてコピーしてね");
        });
      }

      return copyInstead(shareUrl, "LINE の外なので、招待のリンクをコピーしました。トークに貼って送れます。", "招待のリンクを長押ししてコピーしてね");
    });
  }

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

  function reload(url, clearStorage) {
    if (clearStorage) {
      clearAppStorage();
    }
    window.location.href = url || window.location.href;
  }

  window.OthelloPlatform = {
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
    buildFlexResultMessage: buildFlexResultMessage,
    buildFlexInviteMessage: buildFlexInviteMessage,
    reload: reload
  };
}(window, document));
