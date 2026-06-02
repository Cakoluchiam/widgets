window.FC = window.FC || {};

FC.dialogs = {
  _el: null,

  _show(html) {
    this._dismiss();
    const overlay = document.createElement('div');
    overlay.id = 'dialog-overlay';
    overlay.innerHTML = `<div class="dialog-box">${html}</div>`;
    document.body.appendChild(overlay);
    this._el = overlay;
    // Tap outside to cancel
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) this._dismiss();
    });
    return overlay;
  },

  _dismiss() {
    if (this._el) {
      this._el.remove();
      this._el = null;
    }
  },

  // Generic confirm — returns a Promise that resolves with the chosen value.
  confirm({ title, message, choices }) {
    return new Promise((resolve) => {
      const btns = choices.map(c =>
        `<button class="dialog-btn" data-val="${c.value}">${c.label}</button>`
      ).join('');
      const overlay = this._show(`
        <h2 class="dialog-title">${title}</h2>
        <p class="dialog-msg">${message}</p>
        <div class="dialog-btns">${btns}</div>
      `);
      overlay.querySelectorAll('.dialog-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const val = btn.dataset.val;
          this._dismiss();
          resolve(val);
        });
      });
    });
  },

  // New-game dialog with random/entry options and % solved.
  newGame({ gamesPlayed, gamesSolved, hasAuth }) {
    const pct = this._formatPct(gamesSolved, gamesPlayed);
    const progressLine = gamesPlayed > 0
      ? `<p class="dialog-progress">You've solved ${gamesSolved} of ${gamesPlayed} games played (${pct}%)</p>`
      : '';

    return new Promise((resolve) => {
      const overlay = this._show(`
        <h2 class="dialog-title">New Game</h2>
        ${progressLine}
        <div class="dialog-btns">
          <button class="dialog-btn" data-val="random-all">🎲 Random (all solvable)</button>
          <button class="dialog-btn" data-val="random-unsolved" ${!hasAuth ? 'disabled title="Sign in to use"' : ''}>
            🔍 Random (unsolved by you)
          </button>
          <button class="dialog-btn" data-val="enter">✏️ Enter game number</button>
          <button class="dialog-btn dialog-btn-cancel" data-val="cancel">Cancel</button>
        </div>
      `);
      overlay.querySelectorAll('.dialog-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.disabled) return;
          const val = btn.dataset.val;
          this._dismiss();
          resolve(val);
        });
      });
    });
  },

  // Text input dialog — returns the entered value or null on cancel.
  textInput({ title, placeholder, initial }) {
    return new Promise((resolve) => {
      const overlay = this._show(`
        <h2 class="dialog-title">${title}</h2>
        <input class="dialog-input" type="number" min="1" max="1000000"
               placeholder="${placeholder || ''}" value="${initial || ''}">
        <div class="dialog-btns">
          <button class="dialog-btn" data-val="ok">OK</button>
          <button class="dialog-btn dialog-btn-cancel" data-val="cancel">Cancel</button>
        </div>
      `);
      const input = overlay.querySelector('.dialog-input');
      input.focus();
      input.select();
      overlay.querySelector('[data-val="ok"]').addEventListener('click', () => {
        const v = parseInt(input.value, 10);
        this._dismiss();
        resolve(isNaN(v) ? null : v);
      });
      overlay.querySelector('[data-val="cancel"]').addEventListener('click', () => {
        this._dismiss();
        resolve(null);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') overlay.querySelector('[data-val="ok"]').click();
        if (e.key === 'Escape') overlay.querySelector('[data-val="cancel"]').click();
      });
    });
  },

  // Win dialog.
  gameWon({ moveCount }) {
    return this.confirm({
      title: '🎉 You won!',
      message: `Completed in ${moveCount} moves.`,
      choices: [
        { value: 'save', label: '💾 Save score' },
        { value: 'new', label: '🃏 New game' },
      ],
    });
  },

  // Username override dialog.
  usernameOverride(current) {
    return this.textInput({
      title: 'Change display name',
      placeholder: 'Your name',
      initial: current,
    });
  },

  _formatPct(solved, played) {
    if (played === 0) return '0';
    const raw = (solved / 1000000) * 100; // out of 1M total games
    if (played < 100) return raw.toFixed(4);
    if (played < 1000) return raw.toFixed(3);
    return raw.toFixed(2);
  },
};
