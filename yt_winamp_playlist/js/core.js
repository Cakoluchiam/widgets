/* ────────────────────────────────────────────────────────────
   core.js — namespace, app state, persistence, small helpers.

   Global namespace pattern (window.YWP) with plain <script> tags
   so the widget also runs from file:// — same approach as
   finger_paint. No build step, no ES modules.

   State shape:
     tracks:  [ { id, title, artist, album, seconds, videoId,
                  match: null | { path, score, auto } ,
                  candidates: [ {path, score}, ... ] } ]
   The indexed library itself lives on YWP.library, not here — it
   can be tens of thousands of paths, so it is deliberately kept in
   memory only. Everything in this object is mirrored to
   localStorage so a reload does not lose a half-finished playlist.
   ──────────────────────────────────────────────────────────── */
window.YWP = window.YWP || {};

YWP.STORAGE_KEY = 'ytWinampPlaylist.v1';

YWP.state = {
  playlistName: 'YouTube Playlist',
  tracks:       [],
  options: {
    cleanTitles:   true,
    splitArtist:   true,
    pathPrefix:    '',
    pathStyle:     'absolute',   // 'absolute' | 'relative'
    pathSeparator: 'win',        // 'win' (\) | 'posix' (/)
    dropUnmatched: false,
    audioExts:     'mp3,m4a,flac,ogg,opus,wav,wma,aac,mpc,ape,wv',
    ytdlpFormat:   'mp3',
  },
  apiKey: '',
};

/* ── persistence ─────────────────────────────────────────── */

YWP.save = function save() {
  try {
    const s = YWP.state;
    localStorage.setItem(YWP.STORAGE_KEY, JSON.stringify({
      playlistName: s.playlistName,
      // `candidates` is derived from the library and can be large — drop it.
      tracks:  s.tracks.map(t => Object.assign({}, t, { candidates: [] })),
      options: s.options,
      apiKey:  s.apiKey,
    }));
  } catch (e) {
    // Quota or a privacy mode that blocks storage. Non-fatal: the session
    // still works, it just will not survive a reload.
    console.warn('[ywp] could not persist state:', e);
  }
};

YWP.load = function load() {
  try {
    const raw = localStorage.getItem(YWP.STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    const s = YWP.state;
    if (data.playlistName) s.playlistName = data.playlistName;
    if (Array.isArray(data.tracks)) {
      s.tracks = data.tracks.map(t => Object.assign({ candidates: [], match: null }, t));
    }
    if (data.options) Object.assign(s.options, data.options);
    if (typeof data.apiKey === 'string') s.apiKey = data.apiKey;
  } catch (e) {
    console.warn('[ywp] could not restore state:', e);
  }
};

/* ── helpers ─────────────────────────────────────────────── */

let _idSeq = 0;
YWP.nextId = () => 't' + (++_idSeq) + '-' + Math.random().toString(36).slice(2, 7);

/* "3:47" | "1:02:11" | "227" → seconds. Returns -1 when unknown, which is
   what both M3U (#EXTINF) and PLS (LengthN) use for "no duration". */
YWP.parseDuration = function parseDuration(text) {
  if (text == null) return -1;
  if (typeof text === 'number') return Number.isFinite(text) ? Math.round(text) : -1;
  const m = String(text).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (m) {
    const h = parseInt(m[1] || '0', 10), min = parseInt(m[2], 10), sec = parseInt(m[3], 10);
    return h * 3600 + min * 60 + sec;
  }
  const plain = String(text).trim().match(/^\d+$/);
  return plain ? parseInt(plain[0], 10) : -1;
};

YWP.formatDuration = function formatDuration(sec) {
  if (sec == null || sec < 0) return '—';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = n => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};

/* ISO 8601 duration from the YouTube Data API ("PT4M13S") → seconds. */
YWP.parseIsoDuration = function parseIsoDuration(iso) {
  const m = /^P(?:([\d.]+)D)?T(?:([\d.]+)H)?(?:([\d.]+)M)?(?:([\d.]+)S)?$/.exec(iso || '');
  if (!m) return -1;
  return Math.round((+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0));
};

/* Characters Windows forbids in a filename, plus the ones that make
   shell quoting miserable. Used for the yt-dlp output template and for
   the downloaded playlist's own filename. */
YWP.sanitizeFilename = function sanitizeFilename(name, fallback) {
  const cleaned = String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return cleaned || fallback || 'playlist';
};

YWP.download = function download(filename, text, mime) {
  // A BOM is deliberately omitted: Winamp reads .m3u8 as UTF-8 by
  // definition, and a stray BOM shows up inside the first #EXTM3U line
  // in some older tag editors.
  const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.getElementById('download-anchor') || document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
};

YWP.copyToClipboard = async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    // Clipboard API needs a secure context; fall back to a hidden textarea.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e2) {
      return false;
    }
  }
};

YWP.escapeHtml = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
