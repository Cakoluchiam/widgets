window.FC = window.FC || {};

FC.rules = {
  // Can `card` be placed on top of `targetCard` in the tableau?
  // Requires opposite color and rank exactly one lower.
  canPlaceOnTableau(card, targetCard) {
    if (targetCard === undefined || targetCard === null) return true; // empty column
    const rankDiff = FC.cardRank(targetCard) - FC.cardRank(card);
    const colorDiff = FC.isRed(card) !== FC.isRed(targetCard);
    return rankDiff === 1 && colorDiff;
  },

  // Can `card` be placed on a foundation for `suit`?
  // foundationRank: -1 = empty (needs Ace), 0–11 = current top rank.
  canPlaceOnFoundation(card, suit, foundationRank) {
    if (FC.cardSuit(card) !== suit) return false;
    return FC.cardRank(card) === foundationRank + 1;
  },

  // Is there a free cell available?
  hasFreeCell(freecells) {
    return freecells.some(fc => fc === -1);
  },

  // Maximum number of cards movable as a sequence (pseudo-multi-move rule).
  // = (emptyFreeCells + 1) * 2^(emptyColumns)
  maxMovableSequence(freecells, columns) {
    const emptyFC = freecells.filter(fc => fc === -1).length;
    const emptyCols = columns.filter(col => col.length === 0).length;
    return (emptyFC + 1) * Math.pow(2, emptyCols);
  },

  // Is the top of column `col` a valid built sequence of length `count`?
  // (Alternating colors, descending ranks from the top card downward.)
  isValidSequence(col, count) {
    if (col.length < count) return false;
    for (let i = col.length - 1; i > col.length - count; i--) {
      if (!FC.rules.canPlaceOnTableau(col[i], col[i - 1])) return false;
    }
    return true;
  },

  // All legal moves from the current board state.
  // Returns array of move objects: { type, fromZone, fromIdx, toZone, toIdx, card }
  getLegalMoves(board) {
    const moves = [];
    const { columns, freecells, foundations } = board;

    // Sources: top of each tableau column, each occupied free cell
    const sources = [];
    for (let c = 0; c < 8; c++) {
      if (columns[c].length > 0) {
        sources.push({ zone: 'tableau', idx: c, card: columns[c][columns[c].length - 1] });
      }
    }
    for (let f = 0; f < 4; f++) {
      if (freecells[f] !== -1) {
        sources.push({ zone: 'freecell', idx: f, card: freecells[f] });
      }
    }

    for (const src of sources) {
      const card = src.card;

      // → Foundation
      for (const suit of FC.SUITS) {
        if (FC.rules.canPlaceOnFoundation(card, suit, foundations[suit])) {
          const toIdx = FC.SUITS.indexOf(suit);
          moves.push({ fromZone: src.zone, fromIdx: src.idx, toZone: 'foundation', toIdx, card });
        }
      }

      // → Free cell (only from tableau)
      if (src.zone === 'tableau' && FC.rules.hasFreeCell(freecells)) {
        const toIdx = freecells.indexOf(-1);
        moves.push({ fromZone: 'tableau', fromIdx: src.idx, toZone: 'freecell', toIdx, card });
      }

      // → Tableau column
      for (let c = 0; c < 8; c++) {
        if (src.zone === 'tableau' && src.idx === c) continue;
        const targetCard = columns[c].length > 0 ? columns[c][columns[c].length - 1] : undefined;
        if (FC.rules.canPlaceOnTableau(card, targetCard)) {
          // Check sequence moves from tableau (count > 1)
          if (src.zone === 'tableau') {
            const maxSeq = FC.rules.maxMovableSequence(freecells, columns);
            for (let count = 1; count <= Math.min(maxSeq, columns[src.idx].length); count++) {
              if (!FC.rules.isValidSequence(columns[src.idx], count)) break;
              const seqTop = columns[src.idx][columns[src.idx].length - count];
              if (count === 1 || FC.rules.canPlaceOnTableau(seqTop, targetCard)) {
                moves.push({
                  fromZone: 'tableau', fromIdx: src.idx, toZone: 'tableau', toIdx: c,
                  card: seqTop, count,
                });
                if (count > 1) break; // already added the largest valid sequence
              }
            }
          } else {
            // Freecell → tableau (always single card)
            moves.push({ fromZone: 'freecell', fromIdx: src.idx, toZone: 'tableau', toIdx: c, card, count: 1 });
          }
        }
      }
    }

    return moves;
  },

  // Validate a single proposed move against the current board.
  isLegalMove(board, move) {
    const all = FC.rules.getLegalMoves(board);
    return all.some(m =>
      m.fromZone === move.fromZone &&
      m.fromIdx === move.fromIdx &&
      m.toZone === move.toZone &&
      m.toIdx === move.toIdx &&
      (m.count || 1) === (move.count || 1)
    );
  },
};
