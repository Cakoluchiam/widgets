window.FC = window.FC || {};

FC.state = {
  board: null,
  history: [],

  _saveTimer: null,

  newGame(gameNumber) {
    const dealt = FC.deal(gameNumber);
    this.board = {
      columns: dealt.columns,
      freecells: [-1, -1, -1, -1],
      foundations: { c: -1, d: -1, h: -1, s: -1 },
      gameNumber,
      moveCount: 0,
      won: false,
    };
    this.history = [];
    this._scheduleSave();
  },

  snapshot() {
    const b = this.board;
    return {
      columns: b.columns.map(col => col.slice()),
      freecells: b.freecells.slice(),
      foundations: Object.assign({}, b.foundations),
      gameNumber: b.gameNumber,
      moveCount: b.moveCount,
      won: b.won,
    };
  },

  _restore(snap) {
    this.board = {
      columns: snap.columns.map(col => col.slice()),
      freecells: snap.freecells.slice(),
      foundations: Object.assign({}, snap.foundations),
      gameNumber: snap.gameNumber,
      moveCount: snap.moveCount,
      won: snap.won,
    };
  },

  applyMove(move) {
    this.history.push(this.snapshot());
    const b = this.board;

    // Remove card from source
    let card;
    let count = move.count || 1;

    if (move.fromZone === 'freecell') {
      card = b.freecells[move.fromIdx];
      b.freecells[move.fromIdx] = -1;
      count = 1;
    } else {
      // tableau — may move a sequence of `count` cards
      const col = b.columns[move.fromIdx];
      const seq = col.splice(col.length - count, count);
      card = seq[seq.length - 1]; // top card of sequence (for single moves this is the card)

      if (move.toZone === 'tableau') {
        b.columns[move.toIdx].push(...seq);
        b.moveCount++;
        this._scheduleSave();
        return;
      }
      // For non-tableau destinations, only single cards allowed (seq length 1)
      card = seq[0];
    }

    // Place card at destination
    if (move.toZone === 'freecell') {
      b.freecells[move.toIdx] = card;
    } else if (move.toZone === 'foundation') {
      const suit = FC.SUITS[move.toIdx];
      b.foundations[suit] = FC.cardRank(card);
    } else if (move.toZone === 'tableau') {
      b.columns[move.toIdx].push(card);
    }

    b.moveCount++;
    b.won = this.isWon();
    this._scheduleSave();
  },

  undo() {
    if (this.history.length === 0) return false;
    const prev = this.history.pop();
    this._restore(prev);
    // Per spec: undo also increments move count
    this.board.moveCount++;
    this.board.won = false;
    this._scheduleSave();
    return true;
  },

  isWon() {
    const f = this.board.foundations;
    return f.c === 12 && f.d === 12 && f.h === 12 && f.s === 12;
  },

  _scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._save(), 300);
  },

  _save() {
    try {
      localStorage.setItem('FC_currentGame', JSON.stringify({
        board: this.board,
        history: this.history,
      }));
    } catch (e) {
      // localStorage may be full or unavailable — ignore
    }
  },

  loadSaved() {
    try {
      const raw = localStorage.getItem('FC_currentGame');
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || !data.board) return false;
      this.board = data.board;
      this.history = data.history || [];
      return true;
    } catch (e) {
      return false;
    }
  },

  clearSaved() {
    localStorage.removeItem('FC_currentGame');
  },
};
