/* ────────────────────────────────────────────────────────────
   parse.js — turning messy YouTube titles into {artist, title}
   and turning pasted text into a track list.

   Design note: cleanup here is deliberately *conservative*. It only
   removes things that are unambiguously upload noise ("(Official
   Music Video)") because whatever survives is shown to the user and
   written into the playlist's display title. The aggressive
   normalisation — dropping punctuation, casing, "remastered", and so
   on — happens only inside library.js where it is used for matching
   and then thrown away.
   ──────────────────────────────────────────────────────────── */
window.YWP = window.YWP || {};

/* Bracketed fragments that carry no information about which recording
   this is. Matched case-insensitively against the *whole* fragment, so
   "(Live at Wembley)" and "(Acoustic)" survive — those change which
   file you want. */
const NOISE_FRAGMENTS = [
  /^official\s*(music\s*)?(video|audio|visuali[sz]er)?$/,
  /^(official\s*)?lyrics?(\s*video)?$/,
  /^(with\s*)?lyrics?$/,
  /^audio$/, /^video$/, /^visuali[sz]er$/, /^m\/?v$/, /^pv$/,
  /^hd$/, /^hq$/, /^4k$/, /^8k$/, /^1080p?$/, /^720p?$/, /^full\s*hd$/,
  /^explicit$/, /^clean(\s*version)?$/,
  /^free\s*download$/, /^download$/, /^out\s*now$/,
  /^new\s*song$/, /^new$/,
  /^colou?r\s*coded\s*lyrics.*$/,
  /^sub(title)?s?\s*(espa[nñ]ol|english|indo)?$/,
  /^letra$/, /^tradu[cç][aã]o$/,
  /^copyright\s*free$/, /^no\s*copyright(\s*music)?$/,
  /^\d{4}$/,                        // a bare year: "(2011)"
  /^prod\.?\s*by\s+.+$/,            // "(Prod. by X)" — producer credit
];

/* Leading decorations some channels bolt onto the front of a title. */
const LEADING_JUNK = /^\s*(?:[\[【(]\s*(?:mv|m\/v|pv|official|hd|hq|free|new|audio|video)\s*[\]】)]\s*)+/i;

/* Track-number prefixes: "01. ", "1) ", "03 - ", "12. " */
const LEADING_INDEX = /^\s*\d{1,3}\s*[.)\-–:]\s+/;

function stripNoiseFragments(text) {
  // Walk bracketed groups and drop the ones that match a noise pattern.
  let out = String(text);
  for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}'], ['【', '】'], ['「', '」']]) {
    const re = new RegExp('\\' + open + '([^' + '\\' + open + '\\' + close + ']*)\\' + close, 'g');
    out = out.replace(re, (whole, inner) => {
      const probe = inner.trim().toLowerCase().replace(/[!.…]+$/, '');
      return NOISE_FRAGMENTS.some(rx => rx.test(probe)) ? ' ' : whole;
    });
  }
  return out;
}

/* Trailing noise that is not bracketed at all: "Song Title official video" */
const TRAILING_NOISE = /[\s|·•\-–—]+(?:official\s*(?:music\s*)?video|official\s*audio|lyric\s*video|with\s*lyrics|hd|hq|4k)\s*$/i;

YWP.cleanTitle = function cleanTitle(raw) {
  let s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  s = s.replace(LEADING_JUNK, '');
  s = s.replace(LEADING_INDEX, '');
  s = stripNoiseFragments(s);
  s = s.replace(TRAILING_NOISE, '');
  // Collapse the gaps left behind by removed fragments.
  s = s.replace(/\s{2,}/g, ' ')
       .replace(/\s+([,;:!?])/g, '$1')
       .replace(/[\s\-–—|·•]+$/, '')
       .replace(/^[\s\-–—|·•]+/, '')
       .trim();
  return s;
};

/* YouTube's auto-generated artist channels are named "<Artist> - Topic";
   "VEVO" suffixes and a plain "<Artist>VEVO" are the other common shapes. */
YWP.cleanChannelName = function cleanChannelName(name) {
  return String(name == null ? '' : name)
    .replace(/\s*-\s*Topic\s*$/i, '')
    .replace(/\s*VEVO\s*$/i, '')
    .replace(/\s*Official\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const SPLIT_SEPARATORS = [' - ', ' – ', ' — ', ' _ ', ' ~ ', ' // ', ' | ', ' · ', ' • '];

/* Split "Artist - Title" into its two halves.
   `channel` is used as the artist when the title has no separator at all,
   which is the normal case for "<Artist> - Topic" uploads where the video
   title is just the song name. */
YWP.splitArtistTitle = function splitArtistTitle(rawTitle, channel) {
  const title = String(rawTitle == null ? '' : rawTitle).replace(/\s+/g, ' ').trim();
  const chan  = YWP.cleanChannelName(channel);

  // Shape: Artist "Song Name"
  const quoted = title.match(/^(.{1,60}?)\s+["“”'‘’](.+?)["“”'‘’]\s*$/);
  if (quoted) return { artist: quoted[1].trim(), title: quoted[2].trim() };

  let bestIdx = -1, bestSep = null;
  for (const sep of SPLIT_SEPARATORS) {
    const i = title.indexOf(sep);
    if (i > 0 && (bestIdx === -1 || i < bestIdx)) { bestIdx = i; bestSep = sep; }
  }

  if (bestIdx > 0) {
    const left  = title.slice(0, bestIdx).trim();
    const right = title.slice(bestIdx + bestSep.length).trim();
    // Guard against splitting a title that merely contains a dash, e.g.
    // "Everlong - Acoustic". If the right side is only a qualifier and we
    // already know the artist from the channel, keep the title whole.
    const rightIsQualifier = /^(acoustic|live|remix|demo|instrumental|remaster(ed)?|radio edit|extended)\b/i.test(right);
    if (left && right && !(rightIsQualifier && chan)) {
      return { artist: left, title: right };
    }
  }

  return { artist: chan, title: title };
};

/* Build a normalised track record from whatever fields we managed to find. */
YWP.makeTrack = function makeTrack(fields) {
  const opts = YWP.state.options;
  let artist = (fields.artist || '').trim();
  let title  = (fields.title  || '').trim();

  if (!artist && opts.splitArtist) {
    const split = YWP.splitArtistTitle(title, fields.channel);
    artist = split.artist;
    title  = split.title;
  }
  if (opts.cleanTitles) {
    title  = YWP.cleanTitle(title);
    artist = YWP.cleanChannelName(artist);
  }

  return {
    id:      YWP.nextId(),
    title:   title,
    artist:  artist,
    album:   (fields.album || '').trim(),
    seconds: YWP.parseDuration(fields.seconds != null ? fields.seconds : fields.duration),
    videoId: fields.videoId || '',
    match:   null,
    candidates: [],
  };
};

/* ── pasted-text parsing ─────────────────────────────────── */

const DURATION_RE = /^\d{1,2}:\d{2}(?::\d{2})?$/;
const TRAILING_DURATION_RE = /[\s(\[]+(\d{1,2}:\d{2}(?::\d{2})?)\s*[)\]]?\s*$/;

/* YouTube Music's own copy output is one field per line:
       1
       Song Title
       Artist Name
       Album Name
       3:47
   Detect that shape by looking for a bare-integer line followed within
   a few lines by a bare duration line. */
function parseRecordBlocks(lines) {
  const tracks = [];
  let consumed = 0;
  let i = 0;
  while (i < lines.length) {
    const idx = /^\d{1,4}$/.test(lines[i]) ? parseInt(lines[i], 10) : null;
    if (idx === null) { i++; continue; }

    // Find the duration that closes this record, at most 6 lines out. A bare
    // integer only ends the record early if it is the *next* row number —
    // an album called "25" or a bare year must not cut the record short.
    let end = -1;
    for (let j = i + 1; j < Math.min(i + 7, lines.length); j++) {
      if (DURATION_RE.test(lines[j])) { end = j; break; }
      if (/^\d{1,4}$/.test(lines[j]) && parseInt(lines[j], 10) === idx + 1) break;
    }
    if (end === -1) { i++; continue; }

    const body = lines.slice(i + 1, end).filter(l => l && l !== '•');
    if (body.length) {
      tracks.push(YWP.makeTrack({
        title:   body[0],
        artist:  body[1] || '',
        album:   body[2] || '',
        seconds: lines[end],
      }));
      consumed += (end - i) + 1;
    }
    i = end + 1;
  }
  return { tracks, consumed };
}

function parseDelimitedLine(line) {
  // Tab-separated (a copied table) wins over everything else.
  if (line.includes('\t')) {
    const cols = line.split('\t').map(c => c.trim()).filter((c, idx) => !(idx === 0 && /^\d{1,4}$/.test(c)));
    const durIdx = cols.findIndex(c => DURATION_RE.test(c));
    const seconds = durIdx >= 0 ? cols[durIdx] : null;
    const rest = cols.filter((c, idx) => idx !== durIdx);
    return { title: rest[0] || '', artist: rest[1] || '', album: rest[2] || '', seconds };
  }
  // YouTube Music renders metadata rows as "Song • Artist • Album • 3:47".
  if (line.includes('•')) {
    const cols = line.split('•').map(c => c.trim()).filter(Boolean);
    const durIdx = cols.findIndex(c => DURATION_RE.test(c));
    const seconds = durIdx >= 0 ? cols[durIdx] : null;
    const rest = cols.filter((c, idx) => idx !== durIdx);
    if (rest.length >= 2) return { title: rest[0], artist: rest[1], album: rest[2] || '', seconds };
    return { title: rest[0] || '', seconds };
  }
  return null;
}

YWP.parseText = function parseText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];

  // The grabber hands over JSON; accept it here too so one paste box
  // covers every route.
  if (trimmed[0] === '{' || trimmed[0] === '[') {
    try {
      const data = JSON.parse(trimmed);
      const arr = Array.isArray(data) ? data : (data.tracks || data.items || []);
      if (Array.isArray(arr) && arr.length) {
        if (!Array.isArray(data) && data.playlistName) YWP.state.playlistName = data.playlistName;
        return arr.map(YWP.makeTrack);
      }
    } catch (e) { /* not JSON after all — fall through to text parsing */ }
  }

  const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Only trust record mode if it accounted for most of the pasted lines;
  // otherwise a couple of accidental matches would hijack a normal list.
  const blocks = parseRecordBlocks(lines);
  if (blocks.tracks.length && blocks.consumed >= lines.length * 0.6) return blocks.tracks;

  return lines.map(line => {
    const delimited = parseDelimitedLine(line);
    if (delimited) return YWP.makeTrack(delimited);

    let rest = line.replace(LEADING_INDEX, '');
    let seconds = null;
    const dur = rest.match(TRAILING_DURATION_RE);
    if (dur) { seconds = dur[1]; rest = rest.slice(0, dur.index).trim(); }
    return YWP.makeTrack({ title: rest, seconds });
  }).filter(t => t.title || t.artist);
};

/* Pull a playlist id out of anything the user might paste. */
YWP.extractPlaylistId = function extractPlaylistId(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  const m = s.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  // A bare id: playlist ids start with PL/OLAK/RD/UU/LL/FL and similar.
  if (/^[A-Za-z0-9_-]{2,}$/.test(s) && !/^https?:/i.test(s)) return s;
  return '';
};
