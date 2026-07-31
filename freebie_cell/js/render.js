window.FC = window.FC || {};

FC.render = {
  _cardEls: new Map(),
  _layout: null,
  _slotEls: [],
  _bgEls: [],
  _lastConfig: {},

  // ── Layout computation ────────────────────────────────────────────────────

  computeLayout(w, h, board, config) {
    config = config || {};
    const pref = config.orientation || 'device';
    const isLandscape = pref === 'landscape' ? true : pref === 'portrait' ? false : w > h;
    const hudH = config.hudExpanded ? 88 : 44;
    if (isLandscape) {
      return this._computeLayoutLandscape(w, h, board, hudH);
    } else {
      return this._computeLayoutPortrait(w, h, board, hudH);
    }
  },

  _computeLayoutPortrait(w, h, board, hudH) {
    const gap = 4;
    const cardW = Math.floor((w - gap * 9) / 8);
    const cardH = Math.floor(cardW * 7 / 5);
    const topRowY = gap;
    const tableauY = topRowY + cardH + gap * 2;
    const availColH = h - tableauY - hudH - gap;
    const colX = Array.from({ length: 8 }, (_, i) => gap + i * (cardW + gap));
    const freecellX = colX.slice(0, 4);
    const foundationX = colX.slice(4, 8);

    const tallest = board ? Math.max(...board.columns.map(c => c.length), 1) : 7;
    const idealOverlap = Math.floor(cardH * FC.IDEAL_OVERLAP_RATIO);
    const maxOverlap = tallest > 1 ? Math.floor((availColH - cardH) / (tallest - 1)) : idealOverlap;
    const overlapY = Math.min(idealOverlap, maxOverlap);

    return {
      mode: 'portrait',
      cardW, cardH, gap, hudH,
      topRowY, topRowH: cardH, tableauY, availColH,
      colX, freecellX, foundationX,
      sidebarW: 0,
      overlapY,
    };
  },

  _computeLayoutLandscape(w, h, board, hudH) {
    const gap = 4;
    const availH = h - hudH - gap * 2;

    // Card size from height: 4 cards + 5 gaps per sidebar column
    const cardHFromHeight = Math.floor((availH - gap * 5) / 4);
    const cardWFromHeight = Math.floor(cardHFromHeight * 5 / 7);

    // Card size from width: 8 tableau cols + 2 sidebar cols = 10 card widths + 12 gaps
    const cardWFromWidth = Math.floor((w - gap * 12) / 10);

    const cardW = Math.min(cardWFromHeight, cardWFromWidth);
    const cardH = Math.floor(cardW * 7 / 5);

    // Two-column sidebar: left = foundations, right = freecells
    const sidebarW = 2 * cardW + 3 * gap;
    const foundationColX = gap;
    const freecellColX = gap * 2 + cardW;

    // Center sidebar cards vertically in available height
    const sideColH = 4 * cardH + 5 * gap;
    const sideOffsetY = Math.max(gap, Math.floor((availH - sideColH) / 2));
    const foundationY = Array.from({ length: 4 }, (_, i) => sideOffsetY + i * (cardH + gap));
    const freecellY   = Array.from({ length: 4 }, (_, i) => sideOffsetY + i * (cardH + gap));

    // Tableau
    const colX      = Array.from({ length: 8 }, (_, i) => sidebarW + gap + i * (cardW + gap));
    const tableauY  = gap;
    const availColH = h - hudH - gap * 2;

    const tallest = board ? Math.max(...board.columns.map(c => c.length), 1) : 7;
    const idealOverlap = Math.floor(cardH * FC.IDEAL_OVERLAP_RATIO);
    const maxOverlap = tallest > 1 ? Math.floor((availColH - cardH) / (tallest - 1)) : idealOverlap;
    const overlapY = Math.min(idealOverlap, maxOverlap);

    return {
      mode: 'landscape',
      cardW, cardH, gap, hudH,
      tableauY, availColH,
      colX,
      sidebarW, foundationColX, freecellColX,
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
    el.style.left   = x + 'px';
    el.style.top    = y + 'px';
    el.style.width  = w + 'px';
    el.style.height = h + 'px';
    el.style.zIndex = z;
    el.style.transform   = '';
    el.style.visibility  = '';
  },

  // ── Slot and background elements ──────────────────────────────────────────

  _clearSlots() {
    for (const el of this._slotEls) el.remove();
    this._slotEls = [];
    for (const el of this._bgEls) el.remove();
    this._bgEls = [];
  },

  _makeSlot(x, y, w, h, zone, idx, label) {
    const el = document.createElement('div');
    el.className = 'slot';
    el.dataset.zone = zone;
    el.dataset.idx  = idx;
    el.style.left   = x + 'px';
    el.style.top    = y + 'px';
    el.style.width  = w + 'px';
    el.style.height = h + 'px';
    if (label) el.textContent = label;
    document.getElementById('app').appendChild(el);
    this._slotEls.push(el);
    return el;
  },

  _makeSidebarBg(x, w, className) {
    const el = document.createElement('div');
    el.className = 'sidebar-col-bg ' + className;
    el.style.left  = x + 'px';
    el.style.width = w + 'px';
    document.getElementById('app').appendChild(el);
    this._bgEls.push(el);
  },

  // ── Full render ───────────────────────────────────────────────────────────

  renderAll(board, config) {
    if (config) this._lastConfig = config;
    config = this._lastConfig || {};

    const w = window.innerWidth;
    const h = window.innerHeight;
    const L = this.computeLayout(w, h, board, config);
    this._layout = L;

    this._clearSlots();

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
    const { cardW, cardH, topRowY, tableauY, overlapY, colX, freecellX, foundationX } = L;

    for (let f = 0; f < 4; f++) {
      const x = freecellX[f];
      this._makeSlot(x, topRowY, cardW, cardH, 'freecell', f, '');
      if (board.freecells[f] !== -1) {
        const el = this._getOrCreateCardEl(board.freecells[f]);
        el.style.display = '';
        this._placeEl(el, x, topRowY, cardW, cardH, 10);
      }
    }

    for (let i = 0; i < 4; i++) {
      const suit = FC.SUITS[i];
      const x = foundationX[i];
      this._makeSlot(x, topRowY, cardW, cardH, 'foundation', i, FC._suitSymbol(suit));
      if (board.foundations[suit] !== -1) {
        const rank    = board.foundations[suit];
        const cardIdx = i * 13 + rank;
        const el = this._getOrCreateCardEl(cardIdx);
        el.style.display = '';
        this._placeEl(el, x, topRowY, cardW, cardH, 10);
      }
    }

    for (let c = 0; c < 8; c++) {
      const col = board.columns[c];
      const x = colX[c];
      this._makeSlot(x, tableauY, cardW, cardH, 'tableau', c, '');
      for (let r = 0; r < col.length; r++) {
        const y  = tableauY + r * overlapY;
        const z  = 20 + r;
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
            sidebarW, foundationColX, freecellColX, foundationY, freecellY } = L;

    // Sidebar background panels: foundations slightly lighter, freecells slightly darker
    const splitX = Math.floor(sidebarW / 2);
    this._makeSidebarBg(0,      splitX,            'sidebar-foundation-bg');
    this._makeSidebarBg(splitX, sidebarW - splitX, 'sidebar-freecell-bg');

    // Foundations (left sidebar column)
    for (let i = 0; i < 4; i++) {
      const suit = FC.SUITS[i];
      const x = foundationColX;
      const y = foundationY[i];
      this._makeSlot(x, y, cardW, cardH, 'foundation', i, FC._suitSymbol(suit));
      if (board.foundations[suit] !== -1) {
        const rank    = board.foundations[suit];
        const cardIdx = i * 13 + rank;
        const el = this._getOrCreateCardEl(cardIdx);
        el.style.display = '';
        this._placeEl(el, x, y, cardW, cardH, 10);
      }
    }

    // Freecells (right sidebar column)
    for (let f = 0; f < 4; f++) {
      const x = freecellColX;
      const y = freecellY[f];
      this._makeSlot(x, y, cardW, cardH, 'freecell', f, '');
      if (board.freecells[f] !== -1) {
        const el = this._getOrCreateCardEl(board.freecells[f]);
        el.style.display = '';
        this._placeEl(el, x, y, cardW, cardH, 10);
      }
    }

    // Tableau columns
    for (let c = 0; c < 8; c++) {
      const col = board.columns[c];
      const x = colX[c];
      this._makeSlot(x, tableauY, cardW, cardH, 'tableau', c, '');
      for (let r = 0; r < col.length; r++) {
        const y  = tableauY + r * overlapY;
        const z  = 20 + r;
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
    const expanded = !!extra.hudExpanded;

    hud.classList.toggle('expanded', expanded);
    document.getElementById('app').classList.toggle('hud-expanded', expanded);

    const solvedMark = extra.solved
      ? '<span class="solved-mark">✓</span>'
      : '<span class="unsolved-mark">—</span>';

    let bestHtml = '';
    if (extra.userBest !== undefined && extra.userBest !== null) {
      const label = extra.showCommunity ? 'Community' : 'Personal';
      const val   = extra.showCommunity
        ? (extra.communityBest !== null ? extra.communityBest : '—')
        : extra.userBest;
      bestHtml = `<span class="score-best" id="score-best" title="tap to toggle">Best (${label}): ${val}</span>`;
    } else if (extra.communityBest !== undefined && extra.communityBest !== null) {
      bestHtml = `<span class="score-best" id="score-best" title="tap to toggle">Best (Community): ${extra.communityBest}</span>`;
    }

    const stuckHtml  = extra.stuck        ? '<span class="stuck-flag">🚩</span>' : '';
    const autoHtml   = extra.autoSolvable ? '<button class="auto-btn" id="auto-btn">🎉</button>' : '';
    const toggleIcon = expanded ? '🔽' : '🔼';

    if (expanded) {
      hud.innerHTML = `
        <div class="hud-row">
          <span class="hud-game" id="hud-game">#${board.gameNumber}</span>
          <span class="hud-moves">Moves: ${board.moveCount}</span>
          ${solvedMark}${bestHtml}${stuckHtml}${autoHtml}
          <span class="hud-right">
            <span class="hud-user">${username || 'Guest'}</span>
            <button class="hud-btn" id="btn-hud-toggle" title="Collapse HUD">${toggleIcon}</button>
          </span>
        </div>
        <div class="hud-row hud-actions-row">
          <button class="hud-action-btn" id="btn-undo">⏪ Undo</button>
          <button class="hud-action-btn" id="btn-restart">⏮️ Restart</button>
          <button class="hud-action-btn" id="btn-new">🃏 New</button>
          <button class="hud-action-btn" id="btn-settings">⚙️ Settings</button>
        </div>
      `;
    } else {
      hud.innerHTML = `
        <span class="hud-game" id="hud-game">#${board.gameNumber}</span>
        <span class="hud-moves">Moves: ${board.moveCount}</span>
        ${solvedMark}${bestHtml}${stuckHtml}${autoHtml}
        <span class="hud-right">
          <button class="hud-btn" id="btn-undo" title="Undo">⏪</button>
          <button class="hud-btn" id="btn-restart" title="Restart this game">⏮️</button>
          <button class="hud-btn" id="btn-new" title="New game">🃏</button>
          <button class="hud-btn" id="btn-settings" title="Settings">⚙️</button>
          <span class="hud-user">${username || 'Guest'}</span>
          <button class="hud-btn" id="btn-hud-toggle" title="Expand HUD">${toggleIcon}</button>
        </span>
      `;
    }
  },

  // ── Stuck flag ────────────────────────────────────────────────────────────

  setStuck(val) {
    const flag = document.querySelector('.stuck-flag');
    if (flag) flag.style.display = val ? '' : 'none';
  },

  // ── Banner ────────────────────────────────────────────────────────────────

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
      if (L && el.dataset.zone === 'tableau') {
        bottom = r.top + L.availColH;
      }
      return {
        zone: el.dataset.zone,
        idx:  parseInt(el.dataset.idx, 10),
        left: r.left, top: r.top, right: r.right, bottom,
      };
    });
  },

  getLayout() {
    return this._layout;
  },
};

FC._suitSymbol = function(suit) {
  return { c: '♣', d: '♦', h: '♥', s: '♠' }[suit] || '';
};
