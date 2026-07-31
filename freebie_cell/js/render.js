window.FC = window.FC || {};

FC.render = {
  _cardEls: new Map(), // cardIdx → DOM element
  _layout: null,

  // ── Layout computation ────────────────────────────────────────────────────

  computeLayout(w, h, board) {
    if (w > h) {
      return this._computeLayoutLandscape(w, h, board);
    } else {
      return this._computeLayoutPortrait(w, h, board);
    }
  },

  _computeLayoutPortrait(w, h, board) {
    const gap = 4;
    const hudH = 48;
    const cardW = Math.floor((w - gap * 9) / 8);
    const cardH = Math.floor(cardW * 7 / 5);
    const topRowY = gap;
    const tableauY = topRowY + cardH + gap * 2;
    const availColH = h - tableauY - hudH - gap;
    const colX = Array.from({ length: 8 }, (_, i) => gap + i * (cardW + gap));
    const freecellX = colX.slice(0, 4);
    const foundationX = colX.slice(4, 8);
    const topRowH = cardH;

    const tallest = board ? Math.max(...board.columns.map(c => c.length), 1) : 7;
    const idealOverlap = Math.floor(cardH * FC.IDEAL_OVERLAP_RATIO);
    const maxOverlap = tallest > 1 ? Math.floor((availColH - cardH) / (tallest - 1)) : idealOverlap;
    const overlapY = Math.min(idealOverlap, maxOverlap);

    return {
      mode: 'portrait',
      cardW, cardH, gap, hudH,
      topRowY, topRowH, tableauY, availColH,
      colX, freecellX, foundationX,
      sidebarW: 0,
      overlapY,
    };
  },

  _computeLayoutLandscape(w, h, board) {
    const gap = 4;
    const hudH = 44;
    const sidebarW = Math.max(60, Math.floor(w * 0.095));
    const tableauW = w - sidebarW;
    const cardW = Math.floor((tableauW - gap * 9) / 8);
    const cardH = Math.floor(cardW * 7 / 5);
    const topRowY = gap;
    const tableauY = gap;
    const availColH = h - hudH - gap * 2;
    const colX = Array.from({ length: 8 }, (_, i) => sidebarW + gap + i * (cardW + gap));

    // Sidebar: 8 cards (4 foundations + 4 free cells) + 9 gaps must fit in available height.
    const sideCardW = sidebarW - gap * 2;
    const availSideH = h - hudH;
    const minGap = 3;
    const maxSideCardH = Math.floor((availSideH - minGap * 9) / 8);
    const sideCardH = Math.min(Math.floor(sideCardW * 7 / 5), maxSideCardH);
    const sideGap = Math.max(minGap, Math.floor((availSideH - sideCardH * 8) / 9));
    const foundationY = Array.from({ length: 4 }, (_, i) => sideGap + i * (sideCardH + sideGap));
    const freecellY = Array.from({ length: 4 }, (_, i) => {
      const midY = sideGap + 4 * (sideCardH + sideGap) + sideGap;
      return midY + i * (sideCardH + sideGap);
    });

    const tallest = board ? Math.max(...board.columns.map(c => c.length), 1) : 7;
    const idealOverlap = Math.floor(cardH * FC.IDEAL_OVERLAP_RATIO);
    const maxOverlap = tallest > 1 ? Math.floor((availColH - cardH) / (tallest - 1)) : idealOverlap;
    const overlapY = Math.min(idealOverlap, maxOverlap);

    return {
      mode: 'landscape',
      cardW, cardH, gap, hudH,
      topRowY, tableauY, availColH,
      colX,
      sidebarW, sideCardW, sideCardH, sideGap,
      foundationY, freecellY,
      overlapY,
    };
  },

  // ── Card element factory ──────────────────────────────────────────────────

  _makeCardEl(cardIdx) {
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.cardIdx = cardIdx;
    const img = document.createElement('img');
    img.src = 'cards/' + FC.CARD_NAMES[cardIdx] + '.svg';
    img.alt = FC.CARD_NAMES[cardIdx];
    img.draggable = false;
    el.appendChild(img);
    return el;
  },

  _getOrCreateCardEl(cardIdx) {
    if (!this._cardEls.has(cardIdx)) {
      const el = this._makeCardEl(cardIdx);
      document.getElementById('app').appendChild(el);
      this._cardEls.set(cardIdx, el);
    }
    return this._cardEls.get(cardIdx);
  },

  _placeEl(el, x, y, w, h, z) {
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    el.style.zIndex = z;
    el.style.transform = '';
    el.style.visibility = '';
  },

  // ── Slot elements ─────────────────────────────────────────────────────────

  _slotEls: [],

  _clearSlots() {
    for (const el of this._slotEls) el.remove();
    this._slotEls = [];
  },

  _makeSlot(x, y, w, h, zone, idx, label) {
    const el = document.createElement('div');
    el.className = 'slot';
    el.dataset.zone = zone;
    el.dataset.idx = idx;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    if (label) {
      el.textContent = label;
    }
    document.getElementById('app').appendChild(el);
    this._slotEls.push(el);
    return el;
  },

  // ── Full render ───────────────────────────────────────────────────────────

  renderAll(board) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const L = this.computeLayout(w, h, board);
    this._layout = L;

    this._clearSlots();

    // Hide all cards initially; we'll position the ones in play
    for (const el of this._cardEls.values()) {
      el.style.display = 'none';
    }

    if (L.mode === 'portrait') {
      this._renderPortrait(board, L);
    } else {
      this._renderLandscape(board, L);
    }
  },

  _renderPortrait(board, L) {
    const { cardW, cardH, gap, topRowY, tableauY, overlapY, colX, freecellX, foundationX } = L;

    // Free cells
    for (let f = 0; f < 4; f++) {
      const x = freecellX[f];
      this._makeSlot(x, topRowY, cardW, cardH, 'freecell', f, '');
      if (board.freecells[f] !== -1) {
        const el = this._getOrCreateCardEl(board.freecells[f]);
        el.style.display = '';
        this._placeEl(el, x, topRowY, cardW, cardH, 10);
      }
    }

    // Foundations
    for (let i = 0; i < 4; i++) {
      const suit = FC.SUITS[i];
      const x = foundationX[i];
      this._makeSlot(x, topRowY, cardW, cardH, 'foundation', i, FC._suitSymbol(suit));
      if (board.foundations[suit] !== -1) {
        // Show the top foundation card; suit-major encoding: suit_idx*13 + rank
        const rank = board.foundations[suit];
        const cardIdx = i * 13 + rank;
        const el = this._getOrCreateCardEl(cardIdx);
        el.style.display = '';
        this._placeEl(el, x, topRowY, cardW, cardH, 10);
      }
    }

    // Tableau columns
    for (let c = 0; c < 8; c++) {
      const col = board.columns[c];
      const x = colX[c];
      this._makeSlot(x, tableauY, cardW, cardH, 'tableau', c, '');
      for (let r = 0; r < col.length; r++) {
        const y = tableauY + r * overlapY;
        const z = 20 + r;
        const el = this._getOrCreateCardEl(col[r]);
        el.style.display = '';
        this._placeEl(el, x, y, cardW, cardH, z);
        el.dataset.colIdx = c;
        el.dataset.rowIdx = r;
      }
    }
  },

  _renderLandscape(board, L) {
    const { cardW, cardH, gap, tableauY, overlapY, colX,
            sidebarW, sideCardW, sideCardH, foundationY, freecellY } = L;

    // Sidebar: foundations on top
    for (let i = 0; i < 4; i++) {
      const suit = FC.SUITS[i];
      const x = gap;
      const y = foundationY[i];
      this._makeSlot(x, y, sideCardW, sideCardH, 'foundation', i, FC._suitSymbol(suit));
      if (board.foundations[suit] !== -1) {
        const rank = board.foundations[suit];
        const cardIdx = i * 13 + rank; // suit-major: suit_idx*13 + rank
        const el = this._getOrCreateCardEl(cardIdx);
        el.style.display = '';
        this._placeEl(el, x, y, sideCardW, sideCardH, 10);
      }
    }

    // Sidebar: free cells below
    for (let f = 0; f < 4; f++) {
      const x = gap;
      const y = freecellY[f];
      this._makeSlot(x, y, sideCardW, sideCardH, 'freecell', f, '');
      if (board.freecells[f] !== -1) {
        const el = this._getOrCreateCardEl(board.freecells[f]);
        el.style.display = '';
        this._placeEl(el, x, y, sideCardW, sideCardH, 10);
      }
    }

    // Tableau columns (full height)
    for (let c = 0; c < 8; c++) {
      const col = board.columns[c];
      const x = colX[c];
      this._makeSlot(x, tableauY, cardW, cardH, 'tableau', c, '');
      for (let r = 0; r < col.length; r++) {
        const y = tableauY + r * overlapY;
        const z = 20 + r;
        const el = this._getOrCreateCardEl(col[r]);
        el.style.display = '';
        this._placeEl(el, x, y, cardW, cardH, z);
        el.dataset.colIdx = c;
        el.dataset.rowIdx = r;
      }
    }
  },

  // ── HUD ──────────────────────────────────────────────────────────────────

  renderHud(board, username, extra) {
    const hud = document.getElementById('hud');
    if (!hud) return;
    extra = extra || {};

    const solvedMark = extra.solved ? '<span class="solved-mark">✓</span>' : '<span class="unsolved-mark">—</span>';
    let bestHtml = '';
    if (extra.userBest !== undefined && extra.userBest !== null) {
      const label = extra.showCommunity ? 'Community' : 'Personal';
      const val = extra.showCommunity ? (extra.communityBest !== null ? extra.communityBest : '—') : extra.userBest;
      bestHtml = `<span class="score-best" id="score-best" title="tap to toggle">Best (${label}): ${val}</span>`;
    } else if (extra.communityBest !== undefined && extra.communityBest !== null) {
      bestHtml = `<span class="score-best" id="score-best" title="tap to toggle">Best (Community): ${extra.communityBest}</span>`;
    }

    const stuckHtml = extra.stuck ? '<span class="stuck-flag">🚩</span>' : '';
    const autoHtml = extra.autoSolvable ? '<button class="auto-btn" id="auto-btn">🎉</button>' : '';
    // shared slot: autosolve button OR unsolvable notice (mutually exclusive)

    hud.innerHTML = `
      <span class="hud-game" id="hud-game">#${board.gameNumber}</span>
      <span class="hud-moves">Moves: ${board.moveCount}</span>
      ${solvedMark}
      ${bestHtml}
      ${stuckHtml}
      ${autoHtml}
      <span class="hud-right">
        <button class="hud-btn" id="btn-undo" title="Undo">↩</button>
        <button class="hud-btn" id="btn-new" title="New game">🃏</button>
        <button class="hud-btn" id="btn-settings" title="Settings">⚙️</button>
        <span class="hud-user">${username || 'Guest'}</span>
      </span>
    `;
  },

  // ── Stuck flag ────────────────────────────────────────────────────────────

  setStuck(val) {
    const flag = document.querySelector('.stuck-flag');
    if (flag) flag.style.display = val ? '' : 'none';
  },

  // ── Banner (skipping unsolvable, transient messages) ─────────────────────

  showBanner(msg, durationMs) {
    const el = document.getElementById('banner');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    if (durationMs) {
      setTimeout(() => el.classList.add('hidden'), durationMs);
    }
  },

  hideBanner() {
    const el = document.getElementById('banner');
    if (el) el.classList.add('hidden');
  },

  // ── Slot rects (for drag hit-testing) ────────────────────────────────────

  getSlotRects() {
    const L = this._layout;
    return this._slotEls.map(el => {
      const r = el.getBoundingClientRect();
      let bottom = r.bottom;
      // Extend tableau slots to cover the full column height so drops anywhere
      // on a column (including its stacked cards below the slot) are detected.
      if (L && el.dataset.zone === 'tableau') {
        bottom = r.top + L.availColH;
      }
      return {
        zone: el.dataset.zone,
        idx: parseInt(el.dataset.idx, 10),
        left: r.left, top: r.top, right: r.right, bottom,
      };
    });
  },

  getLayout() {
    return this._layout;
  },
};

// Suit symbols for slot labels
FC._suitSymbol = function(suit) {
  return { c: '♣', d: '♦', h: '♥', s: '♠' }[suit] || '';
};
