(function (window, document) {
  var identityPromise = null;

  function generateId(prefix) {
    return prefix + "-" + Math.random().toString(36).slice(2, 10);
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
              showOutsideChoice();
              return;
            }
            // ログイン後は今のページ（?room= 付き）に戻す。指定しないと LIFF の入口に戻り、招待されたルームに入れない
            liff.login({ redirectUri: loginReturnUrl() });
            return;
          }
          reject(new Error("LINE ログインを開始できませんでした。LIFF の設定を確認してください。"));
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

  // LINE の外で開いたとき：「LINE でログインして遊ぶ」か「LINE アプリで開く」を選ぶ画面（キロっく・おくるんと同じ考え方）。
  // LINE アプリで開くときは、招待されたルーム（?room=）もそのまま持っていく
  function showOutsideChoice() {
    var appUrl = "https://liff.line.me/" + window.APP_CONFIG.liffId + window.location.search;
    var box = document.createElement("div");
    box.className = "ls-sheet outside-choice";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.innerHTML =
      '<div class="ls-sheet-card outside-choice-card">' +
      '<img src="' + getAssetUrl("assets/icon.svg") + '" alt="" width="56" height="56">' +
      '<p class="ls-sheet-title">LINE の外で開いています</p>' +
      '<p class="ls-hint outside-choice-text">ひっくりは LINE の友だちと対戦します。どちらかから始めてください。</p>' +
      '<a class="ls-outside-button is-app outside-choice-button" href="' + appUrl + '">💬 LINE アプリで開く</a>' +
      '<button class="ls-outside-button outside-choice-button" type="button">🔑 このブラウザで LINE にログイン</button>' +
      "</div>";
    box.querySelector("button").addEventListener("click", function () {
      liff.login({ redirectUri: loginReturnUrl() });
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

  function shareResult(info) {
    var text = "ひっくりの結果：" + info.myName + " " + info.mine + " - " + info.theirs + " " + info.opponentName;
    if (window.liff &&
        typeof liff.isApiAvailable === "function" &&
        liff.isApiAvailable("shareTargetPicker") &&
        typeof liff.shareTargetPicker === "function") {
      return liff.shareTargetPicker([buildFlexResultMessage(info)]).then(function (result) {
        return { status: result ? "shared" : "cancelled", message: result ? "結果を送りました。" : "送るのをやめました。" };
      }).catch(function () {
        return copyText(text).then(function () {
          return { status: "copied", message: "送れなかったので、結果をコピーしました。" };
        });
      });
    }
    return copyText(text).then(function () {
      return { status: "copied", message: "LINE で送れない環境なので、結果をコピーしました。" };
    });
  }

  function shareRoom(roomId, url) {
    return buildShareUrl(roomId, url).then(function (shareUrl) {
      if (window.liff &&
          typeof liff.isApiAvailable === "function" &&
          liff.isApiAvailable("shareTargetPicker") &&
          typeof liff.shareTargetPicker === "function") {
        return liff.shareTargetPicker([
          buildFlexInviteMessage(roomId, shareUrl)
        ]).then(function (result) {
          if (result) {
            return { status: "shared", message: "LINE で招待メッセージを送信しました。" };
          }
          return { status: "cancelled", message: "招待がキャンセルされました。" };
        }).catch(function () {
          return copyText(shareUrl).then(function () {
            return {
              status: "copied",
              message: "LINE 共有に失敗したため、招待 URL をコピーしました。"
            };
          });
        });
      }

      return copyText(shareUrl).then(function () {
        return {
          status: "copied",
          message: "LINE 共有に未対応のため、招待 URL をコピーしました。"
        };
      });
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
    getAppBaseUrl: getAppBaseUrl,
    getAssetUrl: getAssetUrl,
    buildLiffRoomUrl: buildLiffRoomUrl,
    initIdentity: initIdentity,
    loadVersionInfo: loadVersionInfo,
    copyText: copyText,
    shareRoom: shareRoom,
    shareResult: shareResult,
    buildFlexResultMessage: buildFlexResultMessage,
    reload: reload
  };
}(window, document));
