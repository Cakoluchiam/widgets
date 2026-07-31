window.FC = window.FC || {};

FC.drag = {
  _dragSrc: null,       // { zone, idx, card, count }
  _dragEl: null,
  _ghostEl: null,
  _hiddenDuringDrag: [], // card elements hidden for sequence drag, restored on cleanup
  _pendingTap: null,    // cardIdx awaiting disambiguation
  _highlightedSlots: [],

  init() {
    // Interact.js drag
    interact('.card').draggable({
      listeners: {
        start: (e) => this._onDragStart(e),
        move:  (e) => this._onDragMove(e),
        end:   (e) => this._onDragEnd(e),
      },
      inertia: false,
    });

    // Tap-to-move (pointer events on the app area)
    document.getElementById('app').addEventListener('pointerdown', (e) => this._onPointerDown(e));
    document.getElementById('app').addEventListener('pointerup',   (e) => this._onPointerUp(e));

    this._pdX = 0;
    this._pdY = 0;
    this._pdTime = 0;
  },

  refresh() {
    // Interact.js auto-detects elements by selector — no explicit refresh needed
  },

  // ── Drag handlers ─────────────────────────────────────────────────────────

  _onDragStart(e) {
    const el = e.target;
    const cardIdx = parseInt(el.dataset.cardIdx, 10);
    const src = this._findCardZone(cardIdx);
    if (!src) return;

    this._dragSrc = src;
    this._dragEl = el;

    // Determine if we're dragging a sequence from tableau
    if (src.zone === 'tableau') {
      const col = FC.state.board.columns[src.idx];
      const rowIdx = parseInt(el.dataset.rowIdx, 10);
      const count = col.length - rowIdx;
      const maxSeq = FC.rules.maxMovableSequence(FC.state.board.freecells, FC.state.board.columns);

      if (count > 1 && count <= maxSeq && FC.rules.isValidSequence(col, count)) {
        this._dragSrc.count = count;
        this._buildGhost(col, rowIdx, el);
      } else {
        this._dragSrc.count = 1;
      }
    } else {
      this._dragSrc.count = 1;
    }

    el.style.zIndex = 200;
    el.style.transition = 'none';
    if (this._ghostEl) this._ghostEl.style.zIndex = 200;
  },

  _onDragMove(e) {
    const dx = e.dx;
    const dy = e.dy;
    const el = this._dragEl;
    if (!el) return;

    const cur = el.style.transform;
    let tx = 0, ty = 0;
    if (cur) {
      const m = cur.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
      if (m) { tx = parseFloat(m[1]); ty = parseFloat(m[2]); }
    }
    tx += dx; ty += dy;
    el.style.transform = `translate(${tx}px, ${ty}px)`;
    if (this._ghostEl) this._ghostEl.style.transform = `translate(${tx}px, ${ty}px)`;
  },

  _onDragEnd(e) {
    const el = this._dragEl;
    if (!el || !this._dragSrc) {
      this._cleanup();
      return;
    }

    const target = this._hitTestSlot(e.clientX, e.clientY);
    let accepted = false;
    if (target) {
      const move = {
        fromZone: this._dragSrc.zone,
        fromIdx: this._dragSrc.idx,
        toZone: target.zone,
        toIdx: target.idx,
        card: this._dragSrc.card,
        count: this._dragSrc.count || 1,
      };
      accepted = FC.app.tryMove(move); // calls renderAll on success
    }

    this._cleanup(); // restore visibility on hidden sequence cards
    if (!accepted) {
      FC.render.renderAll(FC.state.board); // restore positions and z-indices on failed drop
    }
  },

  _cleanup() {
    if (this._ghostEl) {
      this._ghostEl.remove();
      this._ghostEl = null;
    }
    // Restore any card elements hidden for a sequence drag (renderAll will reposition them)
    for (const el of this._hiddenDuringDrag) {
      el.style.visibility = '';
    }
    this._hiddenDuringDrag = [];
    this._dragSrc = null;
    this._dragEl = null;
  },

  // ── Ghost for sequence drags ──────────────────────────────────────────────

  _buildGhost(col, fromRowIdx, topEl) {
    const L = FC.render.getLayout();
    if (!L) return;
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.style.position = 'absolute';
    ghost.style.zIndex = 199;
    ghost.style.pointerEvents = 'none';

    const rect = topEl.getBoundingClientRect();
    ghost.style.left = rect.left + 'px';
    ghost.style.top = rect.top + window.scrollY + 'px';

    // Clone cards below the dragged card in the sequence and hide the originals
    // so they don't appear duplicated while the ghost moves.
    for (let r = fromRowIdx + 1; r < col.length; r++) {
      const orig = FC.render._cardEls.get(col[r]);
      if (orig) {
        orig.style.visibility = 'hidden';
        this._hiddenDuringDrag.push(orig);
      }

      const clone = document.createElement('div');
      clone.className = 'card card-ghost-clone';
      clone.style.position = 'absolute';
      clone.style.top = (r - fromRowIdx) * L.overlapY + 'px';
      clone.style.width = L.cardW + 'px';
      clone.style.height = L.cardH + 'px';
      const img = document.createElement('img');
      img.src = 'cards/' + FC.CARD_NAMES[col[r]] + '.svg';
      img.draggable = false;
      clone.appendChild(img);
      ghost.appendChild(clone);
    }

    document.getElementById('app').appendChild(ghost);
    this._ghostEl = ghost;
  },

  // ── Tap-to-move ───────────────────────────────────────────────────────────

  _pdX: 0, _pdY: 0, _pdTime: 0,

  _onPointerDown(e) {
    this._pdX = e.clientX;
    this._pdY = e.clientY;
    this._pdTime = Date.now();
  },

  _onPointerUp(e) {
    const dx = Math.abs(e.clientX - this._pdX);
    const dy = Math.abs(e.clientY - this._pdY);
    const dt = Date.now() - this._pdTime;
    if (dx > 12 || dy > 12 || dt > 350) return; // not a tap

    const el = e.target.closest('.card');
    if (!el) {
      // Tap outside cards: cancel disambiguation if active
      if (this._pendingTap !== null) {
        this._clearHighlights();
        this._pendingTap = null;
      }
      return;
    }

    const cardIdx = parseInt(el.dataset.cardIdx, 10);

    if (this._pendingTap !== null) {
      // Second tap: user chose a highlighted slot — ignored here, handled by slot listener
      this._clearHighlights();
      this._pendingTap = null;
      return;
    }

    this._handleTap(cardIdx, e);
  },

  _handleTap(cardIdx, e) {
    const board = FC.state.board;
    const src = this._findCardZone(cardIdx);
    if (!src) return;

    // Only the top card of a column or a free cell card is tappable
    if (src.zone === 'tableau') {
      const col = board.columns[src.idx];
      if (col[col.length - 1] !== cardIdx) return; // not top card
    }

    // Priority 1: foundation
    for (let i = 0; i < 4; i++) {
      const suit = FC.SUITS[i];
      if (FC.rules.canPlaceOnFoundation(cardIdx, suit, board.foundations[suit])) {
        FC.app.tryMove({ fromZone: src.zone, fromIdx: src.idx, toZone: 'foundation', toIdx: i, card: cardIdx, count: 1 });
        return;
      }
    }

    // Priority 2: tableau columns (may be ambiguous)
    const validCols = [];
    for (let c = 0; c < 8; c++) {
      if (src.zone === 'tableau' && src.idx === c) continue;
      const col = board.columns[c];
      const targetCard = col.length > 0 ? col[col.length - 1] : undefined;
      if (FC.rules.canPlaceOnTableau(cardIdx, targetCard)) {
        validCols.push(c);
      }
    }

    if (validCols.length === 1) {
      FC.app.tryMove({ fromZone: src.zone, fromIdx: src.idx, toZone: 'tableau', toIdx: validCols[0], card: cardIdx, count: 1 });
      return;
    }

    if (validCols.length > 1) {
      // Ambiguous — highlight valid columns and wait for slot tap
      this._pendingTap = { src, cardIdx };
      this._highlightSlots(validCols);
      return;
    }

    // Priority 3: free cell
    if (src.zone !== 'freecell' && FC.rules.hasFreeCell(board.freecells)) {
      const toIdx = board.freecells.indexOf(-1);
      FC.app.tryMove({ fromZone: src.zone, fromIdx: src.idx, toZone: 'freecell', toIdx, card: cardIdx, count: 1 });
    }
  },

  _highlightSlots(colIndices) {
    this._clearHighlights();
    const slotEls = document.querySelectorAll('.slot[data-zone="tableau"]');
    for (const el of slotEls) {
      const idx = parseInt(el.dataset.idx, 10);
      if (colIndices.includes(idx)) {
        el.classList.add('valid-target');
        el.addEventListener('pointerup', this._onSlotTap, { once: true });
        this._highlightedSlots.push(el);
      }
    }
  },

  _onSlotTap(e) {
    const el = e.currentTarget;
    const idx = parseInt(el.dataset.idx, 10);
    const pending = FC.drag._pendingTap;
    FC.drag._clearHighlights();
    FC.drag._pendingTap = null;
    if (pending) {
      FC.app.tryMove({ fromZone: pending.src.zone, fromIdx: pending.src.idx, toZone: 'tableau', toIdx: idx, card: pending.cardIdx, count: 1 });
    }
  },

  _clearHighlights() {
    for (const el of this._highlightedSlots) {
      el.classList.remove('valid-target');
      el.removeEventListener('pointerup', this._onSlotTap);
    }
    this._highlightedSlots = [];
  },

  // ── Hit testing ───────────────────────────────────────────────────────────

  _hitTestSlot(cx, cy) {
    const rects = FC.render.getSlotRects();
    let best = null, bestArea = -1;
    for (const r of rects) {
      if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
        const area = (r.right - r.left) * (r.bottom - r.top);
        if (area > bestArea) { best = r; bestArea = area; }
      }
    }
    return best;
  },

  // ── Zone lookup ───────────────────────────────────────────────────────────

  _findCardZone(cardIdx) {
    const b = FC.state.board;
    for (let f = 0; f < 4; f++) {
      if (b.freecells[f] === cardIdx) return { zone: 'freecell', idx: f, card: cardIdx };
    }
    for (let c = 0; c < 8; c++) {
      if (b.columns[c].includes(cardIdx)) return { zone: 'tableau', idx: c, card: cardIdx };
    }
    return null;
  },

  // ── Card shake (reject feedback) ──────────────────────────────────────────

  shakeCard(cardIdx) {
    const el = FC.render._cardEls.get(cardIdx);
    if (!el) return;
    el.classList.add('shake');
    el.addEventListener('animationend', () => el.classList.remove('shake'), { once: true });
  },
};
