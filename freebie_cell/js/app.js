window.FC = window.FC || {};

FC.app = {
  _username: 'Guest',
  _userScores: null,
  _communityBest: null,
  _showCommunityBest: false,
  _isStuck: false,
  _isAutoSolvable: false,
  _orientation: 'device',
  _hudExpanded: false,

  async init() {
    // Load display preferences
    this._orientation  = localStorage.getItem('FC_orientation')   || 'device';
    this._hudExpanded  = localStorage.getItem('FC_hud_expanded')  === 'true';

    // Firebase + storage
    if (typeof firebase !== 'undefined') {
      try {
        firebase.initializeApp(FC.firebaseConfig);
        FC.storage.init(firebase.firestore());
      } catch (e) {
        console.warn('Firebase init failed:', e);
      }
    }

    // Auth
    FC.auth.init((username) => {
      this._username = username;
      this._loadUserScores();
      this._renderHud();
    });
    this._username = FC.auth.getUsername();

    // Restore in-progress game or start a new one
    if (!FC.state.loadSaved()) {
      this._startRandomGame('random-all');
    }

    // First render
    FC.render.renderAll(FC.state.board, this._getConfig());
    this._renderHud();

    // Wire drag
    FC.drag.init();

    // HUD button events
    document.getElementById('hud').addEventListener('click', (e) => this._onHudClick(e));

    // Re-layout on resize / orientation change
    window.addEventListener('resize', () => {
      FC.render.renderAll(FC.state.board, this._getConfig());
      this._renderHud();
    });

    // Service worker
    if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    this._loadCommunityBest();
  },

  _getConfig() {
    return {
      orientation: this._orientation,
      hudExpanded: this._hudExpanded,
    };
  },

  // ── Move handling ─────────────────────────────────────────────────────────

  tryMove(move) {
    if (!FC.rules.isLegalMove(FC.state.board, move)) {
      FC.drag.shakeCard(move.card);
      return false;
    }
    FC.state.applyMove(move);
    FC.render.renderAll(FC.state.board, this._getConfig());
    this._afterMove();
    return true;
  },

  _afterMove() {
    const board = FC.state.board;
    if (board.won) {
      this._onWin();
      return;
    }
    this._isAutoSolvable = FC.solver.isAutoSolvable(board);
    this._isStuck = !this._isAutoSolvable && FC.solver.isStuck(board);
    this._renderHud();
  },

  undo() {
    if (!FC.state.undo()) return;
    FC.render.renderAll(FC.state.board, this._getConfig());
    this._isAutoSolvable = FC.solver.isAutoSolvable(FC.state.board);
    this._isStuck = !this._isAutoSolvable && FC.solver.isStuck(FC.state.board);
    this._renderHud();
  },

  _restartGame() {
    const num = FC.state.board.gameNumber;
    FC.state.newGame(num);
    this._isAutoSolvable = false;
    this._isStuck = false;
    FC.render.renderAll(FC.state.board, this._getConfig());
    this._renderHud();
  },

  // ── Auto-solve ────────────────────────────────────────────────────────────

  autoSolve() {
    const steps = FC.solver.autoSolveSteps(FC.state.board);
    steps.forEach((move, i) => {
      setTimeout(() => {
        FC.state.applyMove(move);
        FC.render.renderAll(FC.state.board, this._getConfig());
        if (i === steps.length - 1) {
          this._isAutoSolvable = false;
          this._isStuck = false;
          this._afterMove();
        }
      }, 80 * i);
    });
  },

  // ── Win flow ──────────────────────────────────────────────────────────────

  async _onWin() {
    this._isAutoSolvable = false;
    this._isStuck = false;
    this._renderHud();
    FC.state.clearSaved();

    const choice = await FC.dialogs.gameWon({ moveCount: FC.state.board.moveCount });
    if (choice === 'save') {
      await this._saveScore();
    }
    if (choice === 'new' || choice === 'save') {
      this._promptNewGame();
    }
  },

  async _saveScore() {
    if (typeof FC.storage.submitScore !== 'function') return;
    const { gameNumber, moveCount } = FC.state.board;
    await FC.storage.submitScore({
      username: this._username,
      gameNumber,
      moveCount,
      datetime: new Date(),
    }).catch(() => {});
    if (this._userScores) {
      const existing = this._userScores.get(gameNumber);
      if (existing === undefined || moveCount < existing) {
        this._userScores.set(gameNumber, moveCount);
      }
    }
  },

  // ── New game ──────────────────────────────────────────────────────────────

  async _promptNewGame() {
    const scores      = this._userScores;
    const gamesPlayed = scores ? scores.size : 0;
    const gamesSolved = scores ? scores.size : 0;
    const hasAuth     = FC.auth.isSignedIn;

    const choice = await FC.dialogs.newGame({ gamesPlayed, gamesSolved, hasAuth });
    if (choice === 'cancel') return;

    if (choice === 'enter') {
      const num = await FC.dialogs.textInput({ title: 'Enter game number', placeholder: '1 – 1 000 000' });
      if (num === null) return;
      await this._startGame(num);
    } else {
      await this._startRandomGame(choice);
    }
  },

  async _startRandomGame(mode) {
    let num;
    const maxTries = 20;
    for (let i = 0; i < maxTries; i++) {
      num = Math.floor(Math.random() * 1000000) + 1;
      if (FC.UNSOLVABLE.has(num)) continue;
      if (mode === 'random-unsolved' && this._userScores && this._userScores.has(num)) continue;
      break;
    }
    await this._startGame(num);
  },

  async _startGame(num) {
    while (FC.UNSOLVABLE.has(num)) {
      FC.render.showBanner(`Skipping #${num}…`, 1500);
      await new Promise(r => setTimeout(r, 1500));
      num = (num % 1000000) + 1;
    }
    FC.state.newGame(num);
    this._isAutoSolvable = false;
    this._isStuck = false;
    this._communityBest = null;
    FC.state.clearSaved();
    FC.render.renderAll(FC.state.board, this._getConfig());
    this._renderHud();
    this._loadCommunityBest();
  },

  // ── HUD ───────────────────────────────────────────────────────────────────

  _renderHud() {
    const board = FC.state.board;
    if (!board) return;

    const gameNumber = board.gameNumber;
    const userBest   = this._userScores ? (this._userScores.get(gameNumber) ?? null) : null;
    const solved     = userBest !== null;

    FC.render.renderHud(board, this._username, {
      solved,
      userBest,
      communityBest:  this._communityBest,
      showCommunity:  this._showCommunityBest,
      stuck:          this._isStuck,
      autoSolvable:   this._isAutoSolvable,
      hudExpanded:    this._hudExpanded,
    });
  },

  _onHudClick(e) {
    const target = e.target.closest('[id], [data-action]');
    if (!target) return;
    const id = target.id;

    if (id === 'btn-undo')     { this.undo(); return; }
    if (id === 'btn-restart')  { this._restartGame(); return; }
    if (id === 'btn-new')      { this._promptNewGame(); return; }
    if (id === 'btn-settings') { this._promptSettings(); return; }
    if (id === 'btn-hud-toggle') {
      this._hudExpanded = !this._hudExpanded;
      localStorage.setItem('FC_hud_expanded', this._hudExpanded);
      FC.render.renderAll(FC.state.board, this._getConfig());
      this._renderHud();
      return;
    }
    if (id === 'auto-btn')   { this.autoSolve(); return; }
    if (id === 'hud-game')   { this._promptNewGame(); return; }
    if (id === 'score-best') {
      this._showCommunityBest = !this._showCommunityBest;
      this._renderHud();
      return;
    }
  },

  async _promptSettings() {
    const result = await FC.dialogs.settings({
      username:    this._username,
      orientation: this._orientation,
      hudExpanded: this._hudExpanded,
    });
    if (!result) return;

    if (result.username && result.username !== this._username) {
      FC.auth.setUsernameOverride(result.username);
      this._username = FC.auth.getUsername();
    }

    this._orientation = result.orientation;
    localStorage.setItem('FC_orientation', this._orientation);

    this._hudExpanded = result.hudExpanded;
    localStorage.setItem('FC_hud_expanded', this._hudExpanded);

    FC.render.renderAll(FC.state.board, this._getConfig());
    this._renderHud();
  },

  // ── Remote data ───────────────────────────────────────────────────────────

  async _loadUserScores() {
    if (typeof FC.storage.getUserScores !== 'function') return;
    try {
      const scores = await FC.storage.getUserScores(this._username);
      this._userScores = new Map(scores.map(s => [s.gameNumber, s.moveCount]));
      this._renderHud();
    } catch (e) {}
  },

  async _loadCommunityBest() {
    if (!FC.state.board) return;
    if (typeof FC.storage.getGameBestScore !== 'function') return;
    try {
      const best = await FC.storage.getGameBestScore(FC.state.board.gameNumber);
      this._communityBest = best !== null ? best.moveCount : null;
      this._renderHud();
    } catch (e) {}
  },
};

document.addEventListener('DOMContentLoaded', () => FC.app.init());
