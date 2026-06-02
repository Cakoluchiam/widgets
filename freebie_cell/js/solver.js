window.FC = window.FC || {};

FC.solver = {
  // "Trivially solvable" = every remaining card can reach the foundation
  // via a greedy simulation without rearranging free cells or tableau order.
  isAutoSolvable(board) {
    // Work on a shallow clone so we don't mutate real state
    const foundations = Object.assign({}, board.foundations);
    const columns = board.columns.map(c => c.slice());
    const freecells = board.freecells.slice();

    let progress = true;
    while (progress) {
      progress = false;

      // Check top of each column
      for (let c = 0; c < 8; c++) {
        if (columns[c].length === 0) continue;
        const card = columns[c][columns[c].length - 1];
        const suit = FC.cardSuit(card);
        if (FC.rules.canPlaceOnFoundation(card, suit, foundations[suit])) {
          foundations[suit] = FC.cardRank(card);
          columns[c].pop();
          progress = true;
        }
      }

      // Check each free cell
      for (let f = 0; f < 4; f++) {
        if (freecells[f] === -1) continue;
        const card = freecells[f];
        const suit = FC.cardSuit(card);
        if (FC.rules.canPlaceOnFoundation(card, suit, foundations[suit])) {
          foundations[suit] = FC.cardRank(card);
          freecells[f] = -1;
          progress = true;
        }
      }
    }

    return foundations.c === 12 && foundations.d === 12 &&
           foundations.h === 12 && foundations.s === 12;
  },

  // "Stuck" heuristic: no useful move exists.
  // Returns true if no legal move:
  //   (a) sends a card directly to a foundation, OR
  //   (b) exposes a card reachable to foundation in 1–2 more moves, OR
  //   (c) clears a tableau column entirely.
  // Accepts false positives by design.
  isStuck(board) {
    const moves = FC.rules.getLegalMoves(board);

    for (const move of moves) {
      // (a) direct foundation
      if (move.toZone === 'foundation') return false;

      // (c) clears a tableau column
      if (move.fromZone === 'tableau') {
        const count = move.count || 1;
        if (board.columns[move.fromIdx].length === count) return false;
      }

      // (b) exposes a card reachable to foundation in 1–2 moves
      if (move.fromZone === 'tableau') {
        const col = board.columns[move.fromIdx];
        const count = move.count || 1;
        const exposedIdx = col.length - count - 1;
        if (exposedIdx >= 0) {
          const exposed = col[exposedIdx];
          const suit = FC.cardSuit(exposed);
          // 1 move: exposed card can go to foundation directly
          if (FC.rules.canPlaceOnFoundation(exposed, suit, board.foundations[suit])) return false;
          // 2 moves: exposed card could go to foundation after one more move frees the path
          // (simplified: check if exposed rank is within 2 of the next needed)
          const needed = board.foundations[suit] + 1;
          if (FC.cardRank(exposed) === needed + 1) return false;
        }
      }
    }

    return moves.length === 0 || true; // no useful move found
  },

  // Return the greedy auto-solve sequence as an array of moves.
  // Used by app.js to step through with setTimeout delays.
  autoSolveSteps(board) {
    const foundations = Object.assign({}, board.foundations);
    const columns = board.columns.map(c => c.slice());
    const freecells = board.freecells.slice();
    const steps = [];

    let progress = true;
    while (progress) {
      progress = false;

      for (let c = 0; c < 8; c++) {
        if (columns[c].length === 0) continue;
        const card = columns[c][columns[c].length - 1];
        const suit = FC.cardSuit(card);
        if (FC.rules.canPlaceOnFoundation(card, suit, foundations[suit])) {
          foundations[suit] = FC.cardRank(card);
          columns[c].pop();
          steps.push({ fromZone: 'tableau', fromIdx: c, toZone: 'foundation', toIdx: FC.SUITS.indexOf(suit), card, count: 1 });
          progress = true;
        }
      }

      for (let f = 0; f < 4; f++) {
        if (freecells[f] === -1) continue;
        const card = freecells[f];
        const suit = FC.cardSuit(card);
        if (FC.rules.canPlaceOnFoundation(card, suit, foundations[suit])) {
          foundations[suit] = FC.cardRank(card);
          freecells[f] = -1;
          steps.push({ fromZone: 'freecell', fromIdx: f, toZone: 'foundation', toIdx: FC.SUITS.indexOf(suit), card, count: 1 });
          progress = true;
        }
      }
    }

    return steps;
  },
};
