/* ────────────────────────────────────────────────────────────
   library.js — index the local music library and match playlist
   tracks to real files.

   Two ways in, both producing the same record shape:
     • a pasted listing (one path per line, or TSV with tag columns)
     • the File System Access API directory picker

   Matching is two-stage. An inverted token index narrows tens of
   thousands of files down to a few hundred plausible candidates,
   then those are rescored with a character-bigram similarity that
   copes with tokenisation the token pass gets wrong (punctuation
   glued to words, CJK titles with no spaces at all).

   Nothing about a file's *contents* is read — only its path and, if
   the pasted listing supplies them, its tags. That keeps a 20,000
   file library an instant operation.
   ──────────────────────────────────────────────────────────── */
window.YWP = window.YWP || {};

/* Tokens that appear in upload titles but essentially never in a
   filename. Left in the query they only depress the match score. */
const MATCH_STOPWORDS = new Set([
  'official', 'video', 'audio', 'lyric', 'lyrics', 'visualizer', 'visualiser',
  'hd', 'hq', '4k', '8k', 'mv', 'pv', 'explicit', 'clean',
  'feat', 'ft', 'featuring', 'with', 'prod', 'by',
  'remaster', 'remastered', 'remastered2011', 'version', 'edit',
  'topic', 'vevo', 'full', 'complete',
]);

/* Match-time normalisation: far more destructive than the display
   cleanup in parse.js, and the result is never shown to the user. */
function normalize(str) {
  return String(str == null ? '' : str)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // é → e
    .toLowerCase()
    .replace(/[''`´]/g, '')                              // don't → dont
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function tokenize(str) {
  const out = [];
  for (const tok of normalize(str).split(' ')) {
    if (!tok) continue;
    if (MATCH_STOPWORDS.has(tok)) continue;
    out.push(tok);
  }
  return out;
}

function bigramCounts(str) {
  const s = normalize(str).replace(/ /g, '');
  const m = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const b = s.slice(i, i + 2);
    m.set(b, (m.get(b) || 0) + 1);
  }
  return m;
}

/* Sørensen–Dice over character bigrams, counting multiplicities. */
function diceSimilarity(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0, total = 0;
  for (const [k, v] of a) { total += v; const w = b.get(k); if (w) inter += Math.min(v, w); }
  for (const v of b.values()) total += v;
  return total ? (2 * inter) / total : 0;
}

function splitPath(path) {
  const parts = String(path).split(/[\\/]+/).filter(Boolean);
  const base  = parts.length ? parts[parts.length - 1] : String(path);
  const dot   = base.lastIndexOf('.');
  return {
    name: dot > 0 ? base.slice(0, dot) : base,
    ext:  dot > 0 ? base.slice(dot + 1).toLowerCase() : '',
    // Only the two folders nearest the file matter — they are the
    // artist/album pair. Anything above is C:\Users\… noise.
    folders: parts.slice(Math.max(0, parts.length - 3), parts.length - 1),
  };
}

const LEADING_TRACK_NO = /^\s*\d{1,3}\s*[-.)_ ]\s*/;

function makeFileRecord(path, tagArtist, tagTitle) {
  const { name, ext, folders } = splitPath(path);
  const cleanName = name.replace(LEADING_TRACK_NO, '');

  const nameTokens   = new Set(tokenize(cleanName));
  const folderTokens = new Set();
  for (const f of folders) for (const t of tokenize(f)) folderTokens.add(t);

  // Tags, when the listing carried them, are strictly better evidence
  // than the filename — so they join the same token sets rather than
  // replacing them, and the union is what gets scored.
  if (tagTitle)  for (const t of tokenize(tagTitle))  nameTokens.add(t);
  if (tagArtist) for (const t of tokenize(tagArtist)) folderTokens.add(t);

  return {
    path,
    ext,
    display:  (tagArtist && tagTitle) ? (tagArtist + ' - ' + tagTitle) : cleanName,
    bigramSrc: [tagArtist || '', tagTitle || '', cleanName, folders.join(' ')].join(' '),
    nameTokens,
    folderTokens,
    _bigrams: null,    // built lazily, only for finalists
  };
}

function fileBigrams(rec) {
  if (!rec._bigrams) rec._bigrams = bigramCounts(rec.bigramSrc);
  return rec._bigrams;
}

/* ── the index ───────────────────────────────────────────── */

YWP.library = {
  files: [],
  postings: new Map(),     // token → array of file indices
  commonCutoff: Infinity,  // postings longer than this are too generic to seed with

  clear() {
    this.files = [];
    this.postings = new Map();
    this.commonCutoff = Infinity;
  },

  /* Accepts a listing where each line is either a bare path or a
     tab-separated "path<TAB>artist<TAB>title" row. */
  buildFromListing(text, extsCsv) {
    const allowed = new Set(String(extsCsv || '')
      .split(/[,\s]+/).map(e => e.replace(/^\./, '').toLowerCase()).filter(Boolean));

    const records = [];
    const seen = new Set();
    for (const rawLine of String(text || '').split(/\r?\n/)) {
      const line = rawLine.trim().replace(/^["']|["']$/g, '');
      if (!line) continue;
      const cols = line.split('\t');
      const path = cols[0].trim();
      if (!path || seen.has(path)) continue;

      const { ext } = splitPath(path);
      if (allowed.size && !allowed.has(ext)) continue;

      seen.add(path);
      records.push(makeFileRecord(path, (cols[1] || '').trim(), (cols[2] || '').trim()));
    }
    this._install(records);
    return records.length;
  },

  buildFromRecords(records) {
    this._install(records);
    return records.length;
  },

  _install(records) {
    this.files = records;
    this.postings = new Map();
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      for (const tok of r.nameTokens) {
        let arr = this.postings.get(tok);
        if (!arr) this.postings.set(tok, arr = []);
        arr.push(i);
      }
    }
    // A token in more than 12% of files ("the", "live", an artist whose
    // whole discography is present) is useless for narrowing and is only
    // used as a seed when nothing rarer is available.
    this.commonCutoff = Math.max(200, Math.floor(records.length * 0.12));
  },

  size() { return this.files.length; },
};

/* ── scoring ─────────────────────────────────────────────── */

const NUMERIC = /^\d+$/;

function coverage(queryTokens, candidateSet) {
  if (!queryTokens.length) return null;      // null = "no opinion", not zero
  let hit = 0;
  for (const t of queryTokens) if (candidateSet.has(t)) hit++;
  return hit / queryTokens.length;
}

function scoreTokens(track, rec, qTitle, qArtist, qAlbum) {
  const titleRecall = coverage(qTitle, rec.nameTokens);
  if (titleRecall === null) return 0;

  // Precision measured against tokens the query cannot account for.
  // A track number or a folder-derived artist counts as accounted-for,
  // so "01 - Radiohead - Creep.mp3" is not punished for being verbose.
  let explained = 0;
  for (const t of rec.nameTokens) {
    if (NUMERIC.test(t) || qTitle.includes(t) || qArtist.includes(t) || qAlbum.includes(t)) explained++;
  }
  const precision = rec.nameTokens.size ? explained / rec.nameTokens.size : 0;
  const titleScore = 0.78 * titleRecall + 0.22 * precision;

  // The artist usually lives in a folder name rather than the filename,
  // so it is matched against filename and folders together.
  let artistScore = coverage(qArtist, rec.folderTokens);
  const fromName = coverage(qArtist, rec.nameTokens);
  if (artistScore === null) artistScore = fromName;
  else if (fromName !== null) artistScore = Math.max(artistScore, fromName);

  if (artistScore === null) return titleScore;          // artist unknown: title carries it all
  return 0.70 * titleScore + 0.30 * artistScore;
}

/* Confidence bands used by the UI and by "drop unmatched". */
YWP.MATCH_STRONG = 0.74;
YWP.MATCH_WEAK   = 0.50;

YWP.matchTrack = function matchTrack(track, lib) {
  const qTitle  = tokenize(track.title);
  const qArtist = tokenize(track.artist);
  const qAlbum  = tokenize(track.album);
  if (!lib.files.length) return { match: null, candidates: [] };

  // Seed the candidate set from the rarest query tokens available.
  const seeds = [];
  for (const t of qTitle.concat(qArtist)) {
    const arr = lib.postings.get(t);
    if (arr) seeds.push(arr);
  }
  const rare = seeds.filter(a => a.length <= lib.commonCutoff);
  const use  = rare.length ? rare : seeds;

  let candidateIdx;
  if (!use.length) {
    // No token in common with anything — nothing sensible to compare against.
    return { match: null, candidates: [] };
  }
  const set = new Set();
  for (const arr of use) for (const i of arr) set.add(i);
  candidateIdx = Array.from(set);

  const scored = [];
  for (const i of candidateIdx) {
    const rec = lib.files[i];
    const s = scoreTokens(track, rec, qTitle, qArtist, qAlbum);
    if (s > 0.18) scored.push({ i, tokenScore: s });
  }
  scored.sort((a, b) => b.tokenScore - a.tokenScore);

  // Second stage: rescore only the finalists with bigram similarity,
  // which is the expensive half.
  const queryBigrams = bigramCounts((track.artist ? track.artist + ' ' : '') + track.title);
  const finalists = scored.slice(0, 40).map(({ i, tokenScore }) => {
    const rec = lib.files[i];
    const bigram = diceSimilarity(queryBigrams, fileBigrams(rec));
    return { path: rec.path, display: rec.display, score: 0.80 * tokenScore + 0.20 * bigram };
  });
  finalists.sort((a, b) => b.score - a.score);

  const candidates = finalists.slice(0, 6);
  const best = candidates[0];
  return {
    match: best && best.score >= YWP.MATCH_WEAK
      ? { path: best.path, display: best.display, score: best.score, auto: true }
      : null,
    candidates,
  };
};

/* Match every track, yielding to the event loop between chunks so the
   progress bar actually paints on a big library. */
YWP.matchAll = async function matchAll(tracks, onProgress) {
  const lib = YWP.library;
  const CHUNK = 25;
  let strong = 0, weak = 0, none = 0;

  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    // A path the user picked by hand outranks anything the matcher finds.
    if (t.match && t.match.auto === false) { strong++; continue; }

    const { match, candidates } = YWP.matchTrack(t, lib);
    t.match = match;
    t.candidates = candidates;
    if (!match) none++;
    else if (match.score >= YWP.MATCH_STRONG) strong++;
    else weak++;

    if (i % CHUNK === CHUNK - 1) {
      if (onProgress) onProgress(i + 1, tracks.length);
      await new Promise(r => setTimeout(r, 0));
    }
  }
  if (onProgress) onProgress(tracks.length, tracks.length);
  return { strong, weak, none };
};

/* ── File System Access API route ────────────────────────── */

YWP.pickMusicFolder = async function pickMusicFolder(extsCsv, onProgress) {
  if (!window.showDirectoryPicker) {
    throw new Error('This browser has no directory picker. Use the pasted-listing route instead ' +
                    '(and note the picker needs http://localhost — it is unavailable on file://).');
  }
  const root = await window.showDirectoryPicker({ id: 'ywp-music', mode: 'read' });
  const allowed = new Set(String(extsCsv || '')
    .split(/[,\s]+/).map(e => e.replace(/^\./, '').toLowerCase()).filter(Boolean));

  const records = [];
  async function walk(dir, prefix) {
    for await (const entry of dir.values()) {
      const rel = prefix ? prefix + '\\' + entry.name : entry.name;
      if (entry.kind === 'directory') {
        await walk(entry, rel);
      } else {
        const { ext } = splitPath(entry.name);
        if (allowed.size && !allowed.has(ext)) continue;
        records.push(makeFileRecord(rel, '', ''));
        if (onProgress && records.length % 250 === 0) {
          onProgress(records.length);
          await new Promise(r => setTimeout(r, 0));
        }
      }
    }
  }
  await walk(root, '');
  YWP.library.buildFromRecords(records);
  return { count: records.length, rootName: root.name };
};

/* Exposed for the self-test page. */
YWP._internals = { normalize, tokenize, diceSimilarity, bigramCounts, splitPath, makeFileRecord };
