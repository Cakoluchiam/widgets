/* ────────────────────────────────────────────────────────────
   grabber.js — the snippet the user pastes into the DevTools
   console on a YouTube Music / YouTube playlist tab.

   Why a console snippet rather than a fetch from this page: a
   playlist page cannot be read cross-origin (CORS), and the private
   playlists people actually care about — Liked Music, personal
   mixes — are not reachable through the public Data API without a
   full OAuth flow. Running inside the already-authenticated tab
   sidesteps both problems and needs no credentials from the user.

   `grabberFn` below is the single source of truth. The text shown in
   the UI is derived from it with Function.prototype.toString(), so
   the copyable snippet can never drift from the code in this file.
   ──────────────────────────────────────────────────────────── */
window.YWP = window.YWP || {};

function grabberFn() {
  const SCROLL_ROUNDS_STABLE = 3;     // stop after N rounds with no new rows
  const SCROLL_DELAY_MS      = 700;
  const SCROLL_MAX_MS        = 180000;

  const isMusic = location.hostname === 'music.youtube.com';
  const ROW_SELECTOR = isMusic
    ? 'ytmusic-responsive-list-item-renderer'
    : 'ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer';

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const text  = el => (el && el.textContent || '').replace(/\s+/g, ' ').trim();
  const rows  = () => Array.from(document.querySelectorAll(ROW_SELECTOR));

  function videoIdFrom(el) {
    const a = el.querySelector('a[href*="watch?v="], a[href*="/watch?"]');
    if (!a) return '';
    try {
      const u = new URL(a.href, location.origin);
      return u.searchParams.get('v') || '';
    } catch (e) { return ''; }
  }

  function readMusicRow(el) {
    const title = text(el.querySelector('.title-column .title, .title-column yt-formatted-string, .title'));
    const cols  = Array.from(el.querySelectorAll('.secondary-flex-columns yt-formatted-string'))
      .map(text).filter(s => s && s !== '•');
    const fixed = text(el.querySelector('.fixed-columns yt-formatted-string, ytmusic-responsive-list-item-fixed-column-renderer'));

    // Secondary columns are [artist, album] on a playlist and
    // [artist, album, plays] on an album page; a play count is never a
    // duration, so pick the duration out of whichever column looks like one.
    const durRe = /^\d{1,2}:\d{2}(?::\d{2})?$/;
    let duration = durRe.test(fixed) ? fixed : '';
    const meta = [];
    for (const c of cols) {
      if (!duration && durRe.test(c)) { duration = c; continue; }
      if (/^[\d.,]+[KMB]?( plays)?$/i.test(c)) continue;
      meta.push(c);
    }
    return { title, artist: meta[0] || '', album: meta[1] || '', duration, videoId: videoIdFrom(el) };
  }

  function readVideoRow(el) {
    const title    = text(el.querySelector('#video-title, a#video-title, .title'));
    const artist   = text(el.querySelector('ytd-channel-name #text, #byline, #channel-name'));
    const duration = text(el.querySelector(
      'ytd-thumbnail-overlay-time-status-renderer #text, ' +
      'ytd-thumbnail-overlay-time-status-renderer span, ' +
      'badge-shape[aria-label], #time-status'));
    return { title, artist, album: '', duration, videoId: videoIdFrom(el) };
  }

  async function loadEverything() {
    const startedAt = Date.now();
    const startY = window.scrollY;
    let stable = 0, last = rows().length;
    console.log('[ywp] loading the whole playlist — do not switch tabs…');

    while (stable < SCROLL_ROUNDS_STABLE && Date.now() - startedAt < SCROLL_MAX_MS) {
      const all = rows();
      // scrollIntoView works whichever element actually owns the scrollbar,
      // which differs between youtube.com and music.youtube.com.
      if (all.length) all[all.length - 1].scrollIntoView({ block: 'end' });
      window.scrollTo(0, document.documentElement.scrollHeight);
      await sleep(SCROLL_DELAY_MS);

      const now = rows().length;
      if (now === last) { stable++; } else { stable = 0; console.log('[ywp] ' + now + ' rows…'); }
      last = now;
    }
    window.scrollTo(0, startY);
    return rows();
  }

  return (async () => {
    const found = await loadEverything();
    const read  = isMusic ? readMusicRow : readVideoRow;
    const tracks = found.map(read).filter(t => t.title);

    const nameEl = document.querySelector(
      'ytmusic-detail-header-renderer .title, ytmusic-responsive-header-renderer .title, ' +
      'yt-dynamic-sizing-formatted-string .title, h1.title, #title yt-formatted-string');
    const playlistName = (nameEl && nameEl.textContent || document.title)
      .replace(/\s+/g, ' ').replace(/\s*-\s*YouTube( Music)?\s*$/i, '').trim();

    const payload = JSON.stringify({ playlistName, source: location.href, tracks }, null, 2);
    console.log('[ywp] captured ' + tracks.length + ' tracks from "' + playlistName + '"');

    // `copy()` is the DevTools console helper — the only clipboard route
    // that works reliably while the console, not the page, has focus.
    let copied = false;
    try {
      if (typeof copy === 'function') { copy(payload); copied = true; }
      else { await navigator.clipboard.writeText(payload); copied = true; }
    } catch (e) { /* fall through to the manual route below */ }

    window.__ywpPlaylist = payload;
    console.log(copied
      ? '[ywp] copied to your clipboard — paste it back into the widget.'
      : '[ywp] clipboard blocked. Run: copy(window.__ywpPlaylist)');
    return payload;
  })();
}

YWP.grabber = {
  fn: grabberFn,
  /* The snippet is wrapped in an IIFE so a paste into the console runs it
     immediately and leaves no globals behind besides __ywpPlaylist. */
  source() { return '(' + grabberFn.toString() + ')();'; },
};
