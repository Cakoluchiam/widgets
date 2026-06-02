window.FC = window.FC || {};

FC.storage = {
  _db: null,

  init(db) {
    this._db = db;
    if (db) {
      db.enablePersistence({ synchronizeTabs: false }).catch(() => {});
    }
  },

  // Submit score — only writes if no existing doc or if newMoveCount is better (lower).
  async submitScore({ username, gameNumber, moveCount, datetime }) {
    if (!this._db) return;
    const ref = this._db.collection('scores').doc(`${username}_${gameNumber}`);
    return this._db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (doc.exists && doc.data().moveCount <= moveCount) return; // existing is better
      tx.set(ref, { username, gameNumber, moveCount, datetime });
    });
  },

  // Lowest moveCount across all users for a given game number.
  async getGameBestScore(gameNumber) {
    if (!this._db) return null;
    const snap = await this._db.collection('scores')
      .where('gameNumber', '==', gameNumber)
      .orderBy('moveCount', 'asc')
      .limit(1)
      .get();
    if (snap.empty) return null;
    return snap.docs[0].data();
  },

  // All scores for a given user (for leaderboard / progress stats).
  async getUserScores(username) {
    if (!this._db) return [];
    const snap = await this._db.collection('scores')
      .where('username', '==', username)
      .get();
    return snap.docs.map(d => d.data());
  },

  // localStorage helpers (current in-progress game)
  saveCurrentGame(boardSnapshot) {
    try {
      localStorage.setItem('FC_currentGame', JSON.stringify(boardSnapshot));
    } catch (e) {}
  },

  loadCurrentGame() {
    try {
      const raw = localStorage.getItem('FC_currentGame');
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },

  clearCurrentGame() {
    localStorage.removeItem('FC_currentGame');
  },
};
