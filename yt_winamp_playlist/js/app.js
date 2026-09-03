/* ────────────────────────────────────────────────────────────
   app.js — boot and event wiring.

   Everything below is glue: it reads controls into YWP.state,
   calls into parse / ytapi / library / exporters, and asks ui.js
   to redraw. No logic of its own worth testing lives here.
   ──────────────────────────────────────────────────────────── */
window.YWP = window.YWP || {};

(function () {
  const { $, $$ } = YWP.ui;
  const ui = YWP.ui;

  /* ── importing ─────────────────────────────────────────── */

  async function importTracks(tracks, opts) {
    opts = opts || {};
    if (!tracks.length) { ui.toast('Nothing recognisable in that input.', true); return 0; }

    YWP.state.tracks = opts.append ? YWP.state.tracks.concat(tracks) : tracks;
    if (opts.name && !opts.append) YWP.state.playlistName = opts.name;
    $('#playlist-name').value = YWP.state.playlistName;

    ui.renderTracks();
    YWP.save();

    // If a library is already indexed, matching the new tracks is the
    // obvious next thing and saves a click.
    if (YWP.library.size()) await runMatch();
    return tracks.length;
  }

  /* ── matching ──────────────────────────────────────────── */

  async function runMatch() {
    if (!YWP.state.tracks.length) { ui.toast('Import a playlist first.', true); return; }
    if (!YWP.library.size())      { ui.toast('Index your music folder first (step 3).', true); return; }

    const bar  = $('#match-progress');
    const fill = bar.querySelector('.progress-bar');
    bar.hidden = false;
    ui.status('#match-status', 'Matching…');

    const stats = await YWP.matchAll(YWP.state.tracks, (done, total) => {
      fill.style.width = (done / total * 100) + '%';
    });

    bar.hidden = true;
    fill.style.width = '0';
    ui.renderTracks();
    YWP.save();

    const bits = [stats.strong + ' matched'];
    if (stats.weak) bits.push(stats.weak + ' to review');
    if (stats.none) bits.push(stats.none + ' with no file');
    ui.status('#match-status', bits.join(', '), stats.none ? 'err' : 'ok');
  }

  /* Absolute paths in the library imply a shared root; offer it as the
     prefix so switching to relative paths does the right thing. */
  function suggestPrefix() {
    const paths = YWP.library.files.slice(0, 400).map(f => f.path);
    const root = YWP.commonRoot(paths);
    if (root) $('#opt-prefix').placeholder = root;
    return root;
  }

  /* ── tabs ──────────────────────────────────────────────── */

  $$('.tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const group = tab.closest('.tabs');
      group.querySelectorAll('.tab').forEach(t => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      // Panels are the siblings that follow this tab strip.
      let el = group.nextElementSibling;
      while (el && el.classList.contains('panel')) {
        el.classList.toggle('is-active', el.id === tab.dataset.panel);
        el = el.nextElementSibling;
      }
    });
  });

  /* ── crossfade modal ───────────────────────────────────── */

  const modal = $('#crossfade-modal');
  const openModal  = () => { modal.hidden = false; };
  const closeModal = () => { modal.hidden = true; };
  $('#btn-crossfade-help').addEventListener('click', openModal);
  $('#btn-crossfade-help-2').addEventListener('click', openModal);
  $('#btn-close-crossfade').addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

  /* ── step 1: grabber ───────────────────────────────────── */

  $('#btn-copy-grabber').addEventListener('click', async () => {
    const ok = await YWP.copyToClipboard(YWP.grabber.source());
    if (ok) ui.toast('Snippet copied — paste it into the console on your playlist tab.');
    else {
      $('#grabber-source').hidden = false;
      $('#grabber-source').textContent = YWP.grabber.source();
      ui.toast('Could not reach the clipboard — copy it from below.', true);
    }
  });

  $('#btn-show-grabber').addEventListener('click', () => {
    const pre = $('#grabber-source');
    pre.textContent = YWP.grabber.source();
    pre.hidden = !pre.hidden;
    $('#btn-show-grabber').textContent = pre.hidden ? 'Show it' : 'Hide it';
  });

  $('#btn-load-grab').addEventListener('click', async () => {
    const raw = $('#grab-input').value.trim();
    if (!raw) { ui.status('#grab-status', 'Paste the grabber output first.', 'err'); return; }
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      ui.status('#grab-status', 'That is not the grabber output — it should start with {', 'err');
      return;
    }
    const list = (payload.tracks || []).map(YWP.makeTrack);
    const n = await importTracks(list, { name: payload.playlistName });
    if (n) ui.status('#grab-status', 'Loaded ' + n + ' tracks.', 'ok');
  });

  /* ── step 1: API ───────────────────────────────────────── */

  $('#btn-fetch-api').addEventListener('click', async () => {
    const btn = $('#btn-fetch-api');
    const id  = YWP.extractPlaylistId($('#api-playlist').value);
    const key = $('#api-key').value.trim();

    if (!id)  { ui.status('#api-status', 'Could not find a playlist id in that.', 'err'); return; }
    if (!key) { ui.status('#api-status', 'An API key is required.', 'err'); return; }

    YWP.state.apiKey = $('#api-remember').checked ? key : '';
    btn.disabled = true;
    ui.status('#api-status', 'Fetching…');
    try {
      const res = await YWP.ytapi.fetchPlaylist(id, key,
        n => ui.status('#api-status', 'Fetched ' + n + ' tracks…'));
      const n = await importTracks(res.tracks, { name: res.playlistName });
      ui.status('#api-status', 'Loaded ' + n + ' tracks.', 'ok');
    } catch (err) {
      ui.status('#api-status', err.message, 'err');
    } finally {
      btn.disabled = false;
      YWP.save();
    }
  });

  /* ── step 1: paste ─────────────────────────────────────── */

  $('#btn-load-paste').addEventListener('click', async () => {
    const list = YWP.parseText($('#paste-input').value);
    const n = await importTracks(list, { append: $('#opt-append').checked });
    if (n) ui.status('#paste-status', 'Loaded ' + n + ' tracks.', 'ok');
  });

  /* ── step 2: list controls ─────────────────────────────── */

  $('#playlist-name').addEventListener('input', e => {
    YWP.state.playlistName = e.target.value;
    YWP.save();
  });

  $('#btn-sort-artist').addEventListener('click', () => {
    YWP.state.tracks.sort((a, b) =>
      (a.artist || '\uffff').localeCompare(b.artist || '\uffff', undefined, { sensitivity: 'base' }) ||
      (a.title  || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }));
    ui.renderTracks();
    YWP.save();
  });

  $('#btn-shuffle').addEventListener('click', () => {
    const a = YWP.state.tracks;
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    ui.renderTracks();
    YWP.save();
  });

  $('#btn-clear-tracks').addEventListener('click', () => {
    if (!YWP.state.tracks.length) return;
    if (!confirm('Remove all ' + YWP.state.tracks.length + ' tracks?')) return;
    YWP.state.tracks = [];
    ui.renderTracks();
    YWP.save();
  });

  /* ── step 3: library ───────────────────────────────────── */

  $('#opt-exts').addEventListener('input', () => {
    YWP.state.options.audioExts = $('#opt-exts').value;
    ui.renderScanScript();
    YWP.save();
  });
  $('#opt-read-tags').addEventListener('change', () => ui.renderScanScript());

  $('#btn-copy-scan').addEventListener('click', async () => {
    const ok = await YWP.copyToClipboard($('#scan-script').textContent);
    ui.toast(ok ? 'Script copied — run it in PowerShell.' : 'Could not reach the clipboard.', !ok);
  });

  $('#btn-load-listing').addEventListener('click', async () => {
    const text = $('#listing-input').value;
    if (!text.trim()) { ui.status('#listing-status', 'Paste the listing first.', 'err'); return; }

    const n = YWP.library.buildFromListing(text, $('#opt-exts').value);
    if (!n) {
      ui.status('#listing-status', 'No files with those extensions in that listing.', 'err');
      return;
    }
    ui.status('#listing-status', n.toLocaleString() + ' files indexed.', 'ok');
    suggestPrefix();
    await runMatch();
  });

  $('#btn-pick-folder').addEventListener('click', async () => {
    try {
      ui.status('#picker-status', 'Scanning…');
      const res = await YWP.pickMusicFolder($('#opt-exts').value,
        n => ui.status('#picker-status', 'Found ' + n.toLocaleString() + ' files…'));
      ui.status('#picker-status', res.count.toLocaleString() + ' files under "' + res.rootName + '".', 'ok');
      // The picker only yields paths relative to the chosen folder, so a
      // prefix is required before these become playable absolute paths.
      $('#opt-prefix').placeholder = 'e.g. D:\\' + res.rootName;
      await runMatch();
    } catch (err) {
      if (err && err.name === 'AbortError') { ui.status('#picker-status', ''); return; }
      ui.status('#picker-status', err.message, 'err');
    }
  });

  $('#btn-rematch').addEventListener('click', runMatch);

  /* ── step 4: options + downloads ───────────────────────── */

  function bindOption(sel, key, prop) {
    $(sel).addEventListener('change', e => {
      YWP.state.options[key] = prop === 'checked' ? e.target.checked : e.target.value;
      YWP.ui.renderPreview();
      YWP.save();
    });
  }
  bindOption('#opt-path-style', 'pathStyle');
  bindOption('#opt-separator', 'pathSeparator');
  bindOption('#opt-drop-unmatched', 'dropUnmatched', 'checked');
  bindOption('#opt-ytdlp-format', 'ytdlpFormat');

  $('#opt-prefix').addEventListener('input', e => {
    YWP.state.options.pathPrefix = e.target.value;
    ui.schedulePreview();
    YWP.save();
  });

  // Switching to relative paths is meaningless without a root to strip,
  // so fill one in from the library if the field is still empty.
  $('#opt-path-style').addEventListener('change', () => {
    if (YWP.state.options.pathStyle === 'relative' && !$('#opt-prefix').value) {
      const root = suggestPrefix();
      if (root) {
        $('#opt-prefix').value = root;
        YWP.state.options.pathPrefix = root;
        ui.renderPreview();
        YWP.save();
      }
    }
  });

  function saveAs(ext, text, mime) {
    if (!YWP.state.tracks.length) { ui.toast('Nothing to export yet.', true); return; }
    const name = YWP.sanitizeFilename(YWP.state.playlistName, 'playlist');
    YWP.download(name + ext, text, mime);
    ui.toast('Saved ' + name + ext);
  }

  $('#btn-dl-m3u8').addEventListener('click', () => saveAs('.m3u8', YWP.exporters.m3u(YWP.state), 'audio/x-mpegurl'));
  $('#btn-dl-m3u') .addEventListener('click', () => saveAs('.m3u',  YWP.exporters.m3u(YWP.state), 'audio/x-mpegurl'));
  $('#btn-dl-pls') .addEventListener('click', () => saveAs('.pls',  YWP.exporters.pls(YWP.state), 'audio/x-scpls'));
  $('#btn-dl-csv') .addEventListener('click', () => saveAs('.csv',  YWP.exporters.csv(YWP.state), 'text/csv'));

  $('#btn-dl-ps1').addEventListener('click', () => {
    const missing = YWP.state.tracks.filter(t => !t.match).length;
    if (!missing) { ui.toast('Every track already has a local file.'); return; }
    saveAs('-fetch.ps1', YWP.exporters.ytdlpPowerShell(YWP.state), 'text/plain');
  });

  /* ── boot ──────────────────────────────────────────────── */

  YWP.load();
  ui.syncControls();
  ui.renderTracks();
})();
