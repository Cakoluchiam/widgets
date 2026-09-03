/* ────────────────────────────────────────────────────────────
   ui.js — rendering and DOM wiring for the track table.

   The table is rebuilt only on structural changes (import, match,
   reorder, delete). Typing in a cell writes straight through to the
   state object and never triggers a rebuild, so focus and the caret
   survive editing a 500-track playlist.

   All row interaction is delegated from <tbody>, so row count has no
   effect on the number of listeners.
   ──────────────────────────────────────────────────────────── */
window.YWP = window.YWP || {};

const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

function basename(p) {
  const parts = String(p || '').split(/[\\/]+/);
  return parts[parts.length - 1] || p;
}

let toastTimer = null;

YWP.ui = {

  $, $$,

  toast(message, isError) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.toggle('err', !!isError);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 6000 : 3000);
  },

  status(selector, message, kind) {
    const el = $(selector);
    if (!el) return;
    el.textContent = message || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  },

  /* ── track table ───────────────────────────────────────── */

  renderTracks() {
    const wrap   = $('#track-table-wrap');
    const tracks = YWP.state.tracks;

    if (!tracks.length) {
      wrap.innerHTML = '<div class="empty">No tracks yet — import a playlist in step 1.</div>';
      this.renderSummary();
      this.renderPreview();
      return;
    }

    const rows = tracks.map((t, i) => this._rowHtml(t, i)).join('');
    wrap.innerHTML =
      '<table class="tracks"><thead><tr>' +
        '<th class="col-idx">#</th><th></th>' +
        '<th>Title</th><th>Artist</th>' +
        '<th class="col-dur">Time</th>' +
        '<th class="col-match">Local file</th>' +
        '<th class="col-act"></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';

    this._bindTable(wrap.querySelector('tbody'));
    this.renderSummary();
    this.renderPreview();
  },

  _rowHtml(t, i) {
    const esc = YWP.escapeHtml;
    return '<tr data-id="' + esc(t.id) + '">' +
      '<td class="col-idx">' + (i + 1) + '</td>' +
      '<td><span class="drag-handle" draggable="true" title="Drag to reorder">⠿</span></td>' +
      '<td><input class="cell-input" data-field="title"  value="' + esc(t.title)  + '"></td>' +
      '<td><input class="cell-input" data-field="artist" value="' + esc(t.artist) + '"></td>' +
      '<td class="col-dur"><input class="cell-input" data-field="seconds" style="text-align:right" value="' +
        esc(t.seconds > 0 ? YWP.formatDuration(t.seconds) : '') + '" placeholder="—"></td>' +
      '<td class="col-match">' + this._matchCellHtml(t) + '</td>' +
      '<td class="col-act"><button class="row-remove" title="Remove">×</button></td>' +
    '</tr>';
  },

  _matchCellHtml(t) {
    const esc = YWP.escapeHtml;
    const cands = t.candidates || [];
    const cls = !t.match ? 'none'
      : (t.match.score >= YWP.MATCH_STRONG || t.match.auto === false) ? 'strong' : 'weak';

    let opts = '<option value="__none__"' + (t.match ? '' : ' selected') + '>— no local file —</option>';

    // A hand-typed path, or a match that is no longer in the candidate
    // list, still needs to be selectable — show it as its own option.
    const inCands = t.match && cands.some(c => c.path === t.match.path);
    if (t.match && !inCands) {
      opts += '<option value="__current__" selected>' + esc(basename(t.match.path)) +
              (t.match.auto === false ? ' (yours)' : '') + '</option>';
    }
    cands.forEach((c, idx) => {
      const sel = t.match && t.match.path === c.path ? ' selected' : '';
      opts += '<option value="c' + idx + '"' + sel + '>' + esc(basename(c.path)) +
              '  ·  ' + Math.round(c.score * 100) + '%</option>';
    });
    opts += '<option value="__custom__">Type a path…</option>';

    const title = t.match ? ' title="' + esc(t.match.path) + '"' : '';
    return '<select class="match-select ' + cls + '"' + title + '>' + opts + '</select>';
  },

  _bindTable(tbody) {
    const byId = id => YWP.state.tracks.find(t => t.id === id);
    const rowId = el => { const tr = el.closest('tr'); return tr && tr.dataset.id; };

    // Straight-through writes: no re-render, so typing is never interrupted.
    tbody.addEventListener('input', e => {
      const field = e.target.dataset && e.target.dataset.field;
      if (!field) return;
      const t = byId(rowId(e.target));
      if (!t) return;
      if (field === 'seconds') t.seconds = YWP.parseDuration(e.target.value);
      else t[field] = e.target.value;
      YWP.ui.schedulePreview();
      YWP.save();
    });

    tbody.addEventListener('change', e => {
      if (!e.target.classList.contains('match-select')) return;
      const tr = e.target.closest('tr');
      const t  = byId(tr.dataset.id);
      if (!t) return;
      const v = e.target.value;

      if (v === '__none__')       { t.match = null; }
      else if (v === '__custom__'){ YWP.ui._promptForPath(tr, t); return; }
      else if (v === '__current__') { /* unchanged */ }
      else {
        const c = t.candidates[parseInt(v.slice(1), 10)];
        // Choosing by hand is a decision, not a guess — auth:false pins it
        // so a later re-match leaves it alone.
        if (c) t.match = { path: c.path, display: c.display, score: c.score, auto: false };
      }
      YWP.ui._refreshMatchCell(tr, t);
      YWP.ui.renderSummary();
      YWP.ui.schedulePreview();
      YWP.save();
    });

    tbody.addEventListener('click', e => {
      if (!e.target.classList.contains('row-remove')) return;
      const id = rowId(e.target);
      YWP.state.tracks = YWP.state.tracks.filter(t => t.id !== id);
      YWP.ui.renderTracks();
      YWP.save();
    });

    this._bindDragReorder(tbody);
  },

  _promptForPath(tr, t) {
    const cell = tr.querySelector('.col-match');
    const input = document.createElement('input');
    input.className = 'cell-input';
    input.placeholder = 'D:\\Music\\Artist\\Album\\Track.mp3';
    input.value = t.match ? t.match.path : '';
    cell.innerHTML = '';
    cell.appendChild(input);
    input.focus();
    input.select();

    let settled = false;
    const finish = commit => {
      if (settled) return;
      settled = true;
      const v = input.value.trim();
      if (commit && v) t.match = { path: v, display: basename(v), score: 1, auto: false };
      else if (commit) t.match = null;
      YWP.ui._refreshMatchCell(tr, t);
      YWP.ui.renderSummary();
      YWP.ui.schedulePreview();
      YWP.save();
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  },

  _refreshMatchCell(tr, t) {
    tr.querySelector('.col-match').innerHTML = this._matchCellHtml(t);
  },

  _bindDragReorder(tbody) {
    let draggedId = null;

    tbody.addEventListener('dragstart', e => {
      if (!e.target.classList.contains('drag-handle')) return;
      const tr = e.target.closest('tr');
      draggedId = tr.dataset.id;
      tr.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      // Firefox will not start a drag unless some data is set.
      e.dataTransfer.setData('text/plain', draggedId);
      e.dataTransfer.setDragImage(tr, 20, 12);
    });

    tbody.addEventListener('dragover', e => {
      if (!draggedId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const tr = e.target.closest('tr');
      $$('.drop-target').forEach(r => r.classList.remove('drop-target'));
      if (tr && tr.dataset.id !== draggedId) tr.classList.add('drop-target');
    });

    tbody.addEventListener('drop', e => {
      if (!draggedId) return;
      e.preventDefault();
      const tr = e.target.closest('tr');
      if (tr && tr.dataset.id !== draggedId) {
        const list = YWP.state.tracks;
        const from = list.findIndex(t => t.id === draggedId);
        const to   = list.findIndex(t => t.id === tr.dataset.id);
        if (from > -1 && to > -1) list.splice(to, 0, list.splice(from, 1)[0]);
      }
      draggedId = null;
      YWP.ui.renderTracks();
      YWP.save();
    });

    tbody.addEventListener('dragend', () => {
      draggedId = null;
      $$('.dragging, .drop-target').forEach(r => r.classList.remove('dragging', 'drop-target'));
    });
  },

  /* ── summary + preview ─────────────────────────────────── */

  renderSummary() {
    const tracks = YWP.state.tracks;
    const el = $('#track-summary');
    if (!tracks.length) { el.innerHTML = ''; return; }

    let strong = 0, weak = 0, none = 0, secs = 0, known = 0;
    for (const t of tracks) {
      if (!t.match) none++;
      else if (t.match.auto === false || t.match.score >= YWP.MATCH_STRONG) strong++;
      else weak++;
      if (t.seconds > 0) { secs += t.seconds; known++; }
    }

    const pills = ['<span class="pill">' + tracks.length + ' track' + (tracks.length === 1 ? '' : 's') + '</span>'];
    if (known) {
      pills.push('<span class="pill">' + YWP.formatDuration(secs) +
                 (known < tracks.length ? ' (' + known + ' timed)' : '') + '</span>');
    }
    // Matches outlive the library index across a reload, so the pills key
    // off the matches themselves rather than off a library being loaded.
    if (strong || weak || YWP.library.size()) {
      if (strong) pills.push('<span class="pill good">' + strong + ' matched</span>');
      if (weak)   pills.push('<span class="pill warn">' + weak + ' to review</span>');
      if (none)   pills.push('<span class="pill bad">' + none + ' with no file</span>');
    }
    el.innerHTML = pills.join('');
  },

  _previewTimer: null,
  schedulePreview() {
    clearTimeout(this._previewTimer);
    this._previewTimer = setTimeout(() => this.renderPreview(), 250);
  },

  renderPreview() {
    const el = $('#export-preview');
    if (!el) return;
    if (!YWP.state.tracks.length) { el.textContent = '(nothing to export yet)'; return; }
    const text  = YWP.exporters.m3u(YWP.state);
    const lines = text.split('\r\n');
    const CAP = 60;
    el.textContent = lines.length > CAP
      ? lines.slice(0, CAP).join('\n') + '\n… ' + (lines.length - CAP) + ' more lines'
      : lines.join('\n');
  },

  /* Reflect state.options back into the controls — used at boot and
     whenever an import changes something the user can also set by hand. */
  syncControls() {
    const o = YWP.state.options;
    $('#playlist-name').value     = YWP.state.playlistName;
    $('#opt-exts').value          = o.audioExts;
    $('#opt-path-style').value    = o.pathStyle;
    $('#opt-prefix').value        = o.pathPrefix;
    $('#opt-separator').value     = o.pathSeparator;
    $('#opt-drop-unmatched').checked = o.dropUnmatched;
    $('#opt-ytdlp-format').value  = o.ytdlpFormat;
    if (YWP.state.apiKey) {
      $('#api-key').value = YWP.state.apiKey;
      $('#api-remember').checked = true;
    }
    this.renderScanScript();
  },

  renderScanScript() {
    $('#scan-script').textContent = YWP.exporters.libraryScanScript(
      $('#opt-exts').value, $('#opt-read-tags').checked);
  },
};
