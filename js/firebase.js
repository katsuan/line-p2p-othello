// Firebase（Firestore）とのつなぎ（AppFirebase）：ルームの文書を読む・作る・書きかえる・見張る。LIFF ID と Firebase の設定もここ。
// matchmaking.js から使う。守りは Firestore のルール（firestore.rules）
(function (window) {
  window.APP_CONFIG = window.APP_CONFIG || {};

  // このアプリは script 読み込み版の Firebase SDK を使うため、
  // ここでは Web アプリ設定値だけを保持します。
  window.APP_CONFIG.liffId = window.APP_CONFIG.liffId || "2009927876-PcLT1IYA";
  window.APP_CONFIG.firebase = window.APP_CONFIG.firebase || {
    apiKey: "AIzaSyDsgzpMW7l9vI0o39OQ5RvBvBk-lh6oNs4", // qcheck-ok: S1 Firebase のウェブ用の鍵（画面に置く前提。守りは Firestore のルール）
    authDomain: "liff-p2p.firebaseapp.com",
    projectId: "liff-p2p",
    storageBucket: "liff-p2p.firebasestorage.app",
    messagingSenderId: "762153086267",
    appId: "1:762153086267:web:ab5d8b98a35496482c9b1e"
  };

  var firebaseApp = null;
  var firestoreDb = null;

  // Firebase の設定が入っているか
  function hasFirebaseConfig() {
    var config = window.APP_CONFIG.firebase || {};
    return config.apiKey &&
      config.apiKey !== "YOUR_FIREBASE_API_KEY" &&
      config.projectId &&
      config.projectId !== "YOUR_FIREBASE_PROJECT_ID";
  }

  // Firebase をはじめて使うときに準備して、Firestore を返す
  function ensureInitialized() {
    if (!hasFirebaseConfig()) {
      throw new Error("Firebase の設定が不足しています。firebase.js の APP_CONFIG.firebase を更新してください。");
    }

    if (!firebaseApp) {
      firebaseApp = firebase.apps && firebase.apps.length ?
        firebase.app() :
        firebase.initializeApp(window.APP_CONFIG.firebase);
      firestoreDb = firebase.firestore();
    }

    return firestoreDb;
  }

  // ルームの置き場（rooms）
  function roomsCollection() {
    return ensureInitialized().collection("rooms");
  }

  // ルーム1つの文書
  function roomDoc(roomId) {
    return roomsCollection().doc(roomId);
  }

  var AppFirebase = {
    // Firebase を準備する
    init: function () {
      return ensureInitialized();
    },

    // ルームを読む。なければ null
    getRoom: function (roomId) {
      return roomDoc(roomId).get().then(function (snapshot) {
        if (!snapshot.exists) {
          return null;
        }

        return snapshot.data();
      });
    },

    // ルームを作る（上書き）
    createRoom: function (roomId, payload) {
      return roomDoc(roomId).set(payload);
    },

    // ルームの一部を書きかえる
    updateRoom: function (roomId, payload) {
      return roomDoc(roomId).set(payload, { merge: true });
    },

    // ルームが変わるたびに onData を呼ぶ（消えたら null）。返すもの：見張りをやめる関数
    subscribeRoom: function (roomId, onData, onError) {
      return roomDoc(roomId).onSnapshot(function (snapshot) {
        if (!snapshot.exists) {
          onData(null);
          return;
        }

        onData(snapshot.data());
      }, onError);
    }
  };

  window.AppFirebase = AppFirebase;
}(window));
