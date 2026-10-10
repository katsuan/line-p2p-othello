# LIFF P2P オセロ

LIFF、Firebase Firestore、PeerJS を使った 2 人対戦オセロです。

## ディレクトリ構成

- `index.html`
  - 静的エントリポイント
- `css/`
  - 画面全体と盤面まわりのスタイル
- `js/`
  - アプリ本体の JavaScript
- `version.json`
  - 版バッジ用の最新バージョン情報
- `firestore.rules`
  - Firestore ルール
- `scripts/update-version.sh`
  - コミット SHA から版情報を更新

## 教養モード

対局前の設定でホストが「ルール：📚 教養」を選ぶと、置けるマスを押したときに4択の問題が出ます。
正解すると石を置け、不正解（「わからない」を含む）なら石を置かずに相手の番になります。

- 盤面は 6×6 / 8×8 から選べます（ふつうのルールでも選べます）
- ジャンルとレベル：漢字（小学・中学・高校）、英単語（中学・高校・大学）、ことわざ・四字熟語、一般教養（やさしい・むずかしい）、数学（小学・中学・高校・大学の微積）
- 問題は「問題の種・マス・そのマスで何回目の挑戦か」から決まるので、通信対戦でも両方の端末で同じ問題になります（問題そのものは送りません）。不正解だったマスは次に別の問題になります
- 問題の種は START のたびに作り直すので、再戦でも別の問題になります
- 数学はその場で計算して作るので、答えは必ず正しくなります
- 言葉の問題は `js/quiz-data.js` の [問い, 答え] の組から作り、まちがいの選択肢は同じレベルの別の組の答えから選びます。同じレベルの中に意味が重なる組を入れないでください
- COM はレベルに応じた確率で正解します

## JavaScript の責務

- `js/main.js`
  - 起動処理
- `js/session.js`
  - 画面状態、ルーム遷移、初期化
- `js/play.js`
  - 対局進行、P2P、再接続、COM
- `js/ui.js`
  - DOM 更新
- `js/game.js`
  - オセロの純粋ロジック（盤面の大きさは配列の長さで決まる）
- `js/quiz.js`
  - 教養モードの問題づくり（ジャンル・レベル・乱数の種）
- `js/quiz-data.js`
  - 教養モードの問題データ
- `js/platform.js`
  - LIFF、共有、バージョン取得、再読込
- `js/matchmaking.js`
  - Firestore の最小利用層
- `js/firebase.js`
  - Firebase 設定と Firestore ラッパー
- `js/webrtc.js`
  - PeerJS ラッパー
- `js/version.js`
  - クライアント表示用の版情報

## CSS の責務

- `css/styles.css`
  - 全体レイアウト、トップバー、共通ボタン
- `css/board.css`
  - 盤面、プレイヤーカード、開始前 UI、結果オーバーレイ

## 設定箇所

- `js/firebase.js`
  - `window.APP_CONFIG.liffId`
  - `window.APP_CONFIG.firebase`
- `js/webrtc.js`
  - PeerJS 接続先

## バージョンバッジ

タイトル横の版バッジは `version.json` を優先して読みます。  
更新は次で行います。

```sh
sh scripts/update-version.sh
```

GitHub Actions 配信では `GITHUB_SHA` を使って自動更新されます。

## GitHub Pages

GitHub Pages を GitHub Actions 配信にしている場合、`.github/workflows/deploy-pages.yml` で版情報更新後にそのままデプロイします。

## Firebase 利用方針

- 通常時の Firestore 利用は最小限です
- ルーム作成
- 参加
- Peer ID 交換

対局進行は P2P を優先します。
