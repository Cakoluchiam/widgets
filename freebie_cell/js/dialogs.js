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

  // Generic confirm — resolves with the chosen value.
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

  // New-game dialog.
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

  // Text input dialog — resolves with the value or null on cancel.
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
        if (e.key === 'Enter')  overlay.querySelector('[data-val="ok"]').click();
        if (e.key === 'Escape') overlay.querySelector('[data-val="cancel"]').click();
      });
    });
  },

  // Win dialog.
  gameWon({ moveCount }) {
    return this.confirm({
      title:   '🎉 You won!',
      message: `Completed in ${moveCount} moves.`,
      choices: [
        { value: 'save', label: '💾 Save score' },
        { value: 'new',  label: '🃏 New game' },
      ],
    });
  },

  // Settings dialog — resolves with { username, orientation, hudExpanded } or null on cancel.
  settings({ username, orientation, hudExpanded }) {
    return new Promise((resolve) => {
      const safeUsername = (username || '').replace(/"/g, '&quot;');

      const orientOptions = [
        { val: 'device',    label: 'Device orientation' },
        { val: 'portrait',  label: 'Portrait' },
        { val: 'landscape', label: 'Landscape' },
      ];
      const orientBtns = orientOptions.map(o =>
        `<button class="dialog-btn dialog-option-btn${orientation === o.val ? ' selected' : ''}"
                 data-group="orient" data-val="${o.val}">${o.label}</button>`
      ).join('');

      const hudOptions = [
        { val: 'compact',  label: '🔼 Compact',  exp: false },
        { val: 'expanded', label: '🔽 Expanded',  exp: true  },
      ];
      const hudBtns = hudOptions.map(o =>
        `<button class="dialog-btn dialog-option-btn${hudExpanded === o.exp ? ' selected' : ''}"
                 data-group="hud" data-val="${o.val}">${o.label}</button>`
      ).join('');

      const overlay = this._show(`
        <h2 class="dialog-title">Settings</h2>
        <label class="dialog-label">Display name</label>
        <input class="dialog-input" type="text" placeholder="Your name" value="${safeUsername}">
        <label class="dialog-label">Screen orientation</label>
        <div class="dialog-option-group">${orientBtns}</div>
        <label class="dialog-label">HUD</label>
        <div class="dialog-option-group">${hudBtns}</div>
        <div class="dialog-btns" style="margin-top:14px">
          <button class="dialog-btn" id="settings-save">Save</button>
          <button class="dialog-btn dialog-btn-cancel" id="settings-cancel">Cancel</button>
        </div>
      `);

      // Radio behaviour within each group
      overlay.querySelectorAll('.dialog-option-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const group = btn.dataset.group;
          overlay.querySelectorAll(`.dialog-option-btn[data-group="${group}"]`)
            .forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
        });
      });

      overlay.querySelector('#settings-save').addEventListener('click', () => {
        const nameInput  = overlay.querySelector('.dialog-input');
        const orientSel  = overlay.querySelector('.dialog-option-btn[data-group="orient"].selected');
        const hudSel     = overlay.querySelector('.dialog-option-btn[data-group="hud"].selected');
        this._dismiss();
        resolve({
          username:    nameInput  ? nameInput.value.trim() : username,
          orientation: orientSel  ? orientSel.dataset.val   : orientation,
          hudExpanded: hudSel     ? hudSel.dataset.val === 'expanded' : hudExpanded,
        });
      });

      overlay.querySelector('#settings-cancel').addEventListener('click', () => {
        this._dismiss();
        resolve(null);
      });
    });
  },

  _formatPct(solved, played) {
    if (played === 0) return '0';
    const raw = (solved / 1000000) * 100;
    if (played < 100)  return raw.toFixed(4);
    if (played < 1000) return raw.toFixed(3);
    return raw.toFixed(2);
  },
};
