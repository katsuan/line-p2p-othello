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
            liff.login();
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
          url: SITE_URL + "assets/ogp.png",
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
            // ルームIDの枠：左に ID、右にピル形の「コピー」
            {
              type: "box",
              layout: "horizontal",
              alignItems: "center",
              spacing: "md",
              paddingAll: "12px",
              backgroundColor: "#EAF5EE",
              cornerRadius: "14px",
              contents: [
                {
                  type: "box",
                  layout: "vertical",
                  flex: 1,
                  contents: [
                    { type: "text", text: "ルームID", size: "xs", color: "#4C6B57" },
                    { type: "text", text: roomId, margin: "sm", weight: "bold", size: "md", color: BRAND_DARK, wrap: true }
                  ]
                },
                {
                  type: "box",
                  layout: "vertical",
                  flex: 0,
                  paddingTop: "6px",
                  paddingBottom: "6px",
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
    reload: reload
  };
}(window, document));
