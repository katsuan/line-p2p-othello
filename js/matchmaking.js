// ルームの席（OthelloMatchmaking）：ホスト・ゲストのどちらで入るかを決め、ルームの文書に席を書く。
// session.js から使う。読み書きは firebase.js
(function (window) {
  // ルームの中身と自分から、入り方を決める（create-host・resume-host・resume-guest・join-guest・full・missing）。
  // legacyUserId：前の版で作ったルーム（ID をそのまま書いていた）にも戻れるように
  function resolveEntry(roomData, userId, joinRequested, legacyUserId) {
    // ルームに書かれた ID が自分か（前の版の ID も見る）
    function isMe(value) {
      return !!value && (value === userId || (!!legacyUserId && value === legacyUserId));
    }
    if (!roomData) {
      return joinRequested ? "missing" : "create-host";
    }
    if (isMe(roomData.hostUserId)) {
      return "resume-host";
    }
    if (isMe(roomData.guestUserId)) {
      return "resume-guest";
    }
    if (!roomData.guestUserId) {
      return "join-guest";
    }
    return "full";
  }

  // ホストとしてルームを開くときに書く中身（ゲストの席は空き）
  function buildHostPayload(roomId, userId, peerId) {
    return {
      roomId: roomId,
      hostUserId: userId,
      guestUserId: "",
      hostPeerId: peerId,
      guestPeerId: "",
      status: "waiting"
    };
  }

  // ゲストとして席に入るときに書く中身
  function buildGuestPayload(userId, peerId) {
    return {
      guestUserId: userId,
      guestPeerId: peerId,
      status: "ready"
    };
  }

  // ゲストがルームを引き継いでホストになるときに書く中身
  function buildPromotedHostPayload(userId, peerId) {
    return {
      hostUserId: userId,
      hostPeerId: peerId,
      guestUserId: "",
      guestPeerId: "",
      status: "waiting"
    };
  }

  // ルームを読む
  function fetchRoom(roomId) {
    return AppFirebase.getRoom(roomId);
  }

  // Firebase を準備する
  function init() {
    return AppFirebase.init();
  }

  // ホストとしてルームを作る
  function createHostRoom(roomId, userId, peerId) {
    return AppFirebase.createRoom(roomId, buildHostPayload(roomId, userId, peerId));
  }

  // ホストのまま、相手の席を空ける
  function resetHostRoom(roomId, userId, peerId) {
    return AppFirebase.updateRoom(roomId, buildHostPayload(roomId, userId, peerId));
  }

  // ゲストとして席に入る
  function joinGuestRoom(roomId, userId, peerId) {
    return AppFirebase.updateRoom(roomId, buildGuestPayload(userId, peerId));
  }

  // ゲストがルームを引き継ぐ
  function promoteGuestToHost(roomId, userId, peerId) {
    return AppFirebase.updateRoom(roomId, buildPromotedHostPayload(userId, peerId));
  }

  // ルームが変わるたびに知らせを受ける
  function subscribeRoom(roomId, onData, onError) {
    return AppFirebase.subscribeRoom(roomId, onData, onError);
  }

  // 相手の端末の通信の ID（自分がホストならゲストの、ゲストならホストの）
  function getRemotePeerId(roomData, role) {
    if (!roomData) {
      return "";
    }
    return role === "host" ? (roomData.guestPeerId || "") : (roomData.hostPeerId || "");
  }

  window.OthelloMatchmaking = {
    init: init,
    resolveEntry: resolveEntry,
    fetchRoom: fetchRoom,
    createHostRoom: createHostRoom,
    resetHostRoom: resetHostRoom,
    joinGuestRoom: joinGuestRoom,
    promoteGuestToHost: promoteGuestToHost,
    subscribeRoom: subscribeRoom,
    getRemotePeerId: getRemotePeerId
  };
}(window));
