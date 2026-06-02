window.FC = window.FC || {};

// Microsoft FreeCell LCG shuffle.
// Reproduces the exact deal for game numbers 1–1,000,000.
//
// Card encoding (suit-major, matching the original MS implementation):
//   index i: suit = floor(i/13), rank = i%13
//   Clubs 0-12, Diamonds 13-25, Hearts 26-38, Spades 39-51
//
// LCG: state = (214013 * state + 2531011) & 0x7FFFFFFF
//      value = (state >> 16) % max
//
// Fisher-Yates runs backward (i = 51 down to 0), j = rand%(i+1).
// Math.imul avoids float precision loss for the 32-bit multiply.
FC.deal = function(gameNumber) {
  let state = gameNumber;

  function nextRand(max) {
    state = (Math.imul(214013, state) + 2531011) & 0x7FFFFFFF;
    return (state >> 16) % max;
  }

  const deck = Array.from({ length: 52 }, (_, i) => i);

  for (let i = 51; i >= 0; i--) {
    const j = nextRand(i + 1);
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }

  // Distribute dealt cards into 8 columns, round-robin left-to-right top-to-bottom.
  // Columns 0-3 receive 7 cards, columns 4-7 receive 6 cards.
  const columns = Array.from({ length: 8 }, () => []);
  for (let i = 0; i < 52; i++) {
    columns[i % 8].push(deck[i]);
  }

  return { columns, gameNumber };
};
