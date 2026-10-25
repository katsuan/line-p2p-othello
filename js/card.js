// LINE に送るカード（招待・対局の結果）。どちらもロゴと同じ盤の緑。ボタンは画面を開く・コピーだけ（あとで押されても困らない）
(function (window) {
  // 招待カード：ロゴ・アイコンと同じ盤の緑。上にロゴ入りの画像（assets/ogp.png）、ボタンも緑
  var BRAND_GREEN = "#1F7A45";
  var BRAND_DARK = "#14542E";
  var SITE_URL = "https://katsuan.github.io/line-p2p-othello/";

  function invite(roomId, shareUrl) {
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

  // 対局の結果のカード（招待カードと同じ緑）。ボタンは「ひっくりで対戦する」（LIFF の入口）
  function result(info) {
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

  window.OthelloCard = { invite: invite, result: result };
}(window));
