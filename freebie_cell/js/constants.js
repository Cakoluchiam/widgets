window.FC = window.FC || {};

FC.SUITS = ['c', 'd', 'h', 's'];
FC.RANKS = ['a', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'j', 'q', 'k'];
FC.RED_SUITS = new Set(['d', 'h']);

// Suit-major ordering matches the MS LCG deal algorithm.
// Index i: suit = floor(i/13), rank = i%13.
// All clubs first (0-12), then diamonds (13-25), hearts (26-38), spades (39-51).
FC.CARD_NAMES = [];
for (let s = 0; s < 4; s++) {
  for (let r = 0; r < 13; r++) {
    FC.CARD_NAMES.push(FC.RANKS[r] + FC.SUITS[s]);
  }
}

// Helpers derived from card index (suit-major encoding)
FC.cardRank = function(idx) { return idx % 13; };           // 0=Ace … 12=King
FC.cardSuit = function(idx) { return FC.SUITS[Math.floor(idx / 13)]; };
FC.cardSuitIdx = function(idx) { return Math.floor(idx / 13); };
FC.isRed = function(idx) { return FC.RED_SUITS.has(FC.cardSuit(idx)); };

// 8 MS FreeCell deals (out of 1–1,000,000) that are provably unsolvable
FC.UNSOLVABLE = new Set([11982, 146692, 186216, 455889, 495505, 512118, 517776, 781948]);

// Ideal overlap fraction — actual overlapY is computed dynamically in render.js
FC.IDEAL_OVERLAP_RATIO = 0.28;
