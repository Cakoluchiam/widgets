/* ────────────────────────────────────────────────────────────
   exporters.js — playlist file generation.

   Everything is emitted with CRLF line endings. Winamp copes with
   bare LF, but a lot of the other Windows tooling people run these
   files through (Notepad, tag editors, foobar's importer) does not.

   Formats:
     .m3u8  extended M3U, UTF-8 — the default, and what Winamp
            handles best for non-ASCII artist names.
     .m3u   extended M3U written the same way but named for players
            that refuse the .m3u8 extension.
     .pls   INI-shaped, Winamp's own original format.
     .csv   not for Winamp — an escape hatch for other tools.
     .ps1   yt-dlp fetch script for tracks with no local file.
   ──────────────────────────────────────────────────────────── */
window.YWP = window.YWP || {};

const CRLF = '\r\n';

function isAbsolutePath(p) {
  return /^[A-Za-z]:[\\/]/.test(p) ||   // C:\…
         /^[\\/]{2}[^\\/]/.test(p) ||   // \\server\share
         /^\//.test(p);                 // /home/…
}

function joinPath(prefix, rest) {
  if (!prefix) return rest;
  const trimmed = prefix.replace(/[\\/]+$/, '');
  return trimmed + '\\' + rest.replace(/^[\\/]+/, '');
}

/* Longest directory prefix shared by every path — offered in the UI as
   the default when the user switches to relative paths. */
YWP.commonRoot = function commonRoot(paths) {
  const lists = paths.filter(Boolean).map(p => p.split(/[\\/]+/));
  if (!lists.length) return '';
  let depth = 0;
  outer: while (true) {
    if (depth >= lists[0].length - 1) break;          // never eat the filename
    const seg = lists[0][depth].toLowerCase();
    for (const l of lists) {
      if (depth >= l.length - 1 || l[depth].toLowerCase() !== seg) break outer;
    }
    depth++;
  }
  return depth ? lists[0].slice(0, depth).join('\\') : '';
};

YWP.resolvePath = function resolvePath(rawPath, opts) {
  let p = String(rawPath || '');
  const prefix = (opts.pathPrefix || '').trim();

  if (opts.pathStyle === 'relative') {
    if (prefix) {
      const norm = s => s.replace(/[\\/]+/g, '\\').toLowerCase();
      const np = norm(p), npre = norm(prefix).replace(/\\+$/, '') + '\\';
      if (np.startsWith(npre)) p = p.slice(npre.length);
    }
  } else if (!isAbsolutePath(p)) {
    p = joinPath(prefix, p);
  }

  return opts.pathSeparator === 'posix'
    ? p.replace(/\\/g, '/')
    : p.replace(/\//g, '\\');
};

/* The rows that actually make it into a playlist file. */
function exportableTracks(state) {
  const rows = state.tracks.filter(t => !t.excluded);
  return state.options.dropUnmatched ? rows.filter(t => t.match) : rows;
}

function displayTitle(t) {
  return t.artist ? (t.artist + ' - ' + t.title) : t.title;
}

/* A track with no matched file still gets a line, so the playlist keeps
   its shape and Winamp shows exactly which songs are missing rather than
   silently shortening the list. */
function lineFor(t, opts) {
  if (t.match) return YWP.resolvePath(t.match.path, opts);
  const guess = YWP.sanitizeFilename(displayTitle(t), 'unknown') + '.mp3';
  return YWP.resolvePath(guess, opts);
}

YWP.exporters = {

  m3u(state) {
    const opts = state.options;
    const out = ['#EXTM3U'];
    for (const t of exportableTracks(state)) {
      const secs = (t.seconds != null && t.seconds > 0) ? t.seconds : -1;
      out.push('#EXTINF:' + secs + ',' + displayTitle(t));
      out.push(lineFor(t, opts));
    }
    return out.join(CRLF) + CRLF;
  },

  pls(state) {
    const opts = state.options;
    const rows = exportableTracks(state);
    const out = ['[playlist]', 'NumberOfEntries=' + rows.length];
    rows.forEach((t, i) => {
      const n = i + 1;
      out.push('File'  + n + '=' + lineFor(t, opts));
      out.push('Title' + n + '=' + displayTitle(t));
      out.push('Length' + n + '=' + ((t.seconds != null && t.seconds > 0) ? t.seconds : -1));
    });
    out.push('Version=2');
    return out.join(CRLF) + CRLF;
  },

  csv(state) {
    const q = v => {
      const s = String(v == null ? '' : v);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const out = ['#,Artist,Title,Album,Seconds,VideoId,MatchedFile,Confidence'];
    exportableTracks(state).forEach((t, i) => {
      out.push([
        i + 1, q(t.artist), q(t.title), q(t.album),
        (t.seconds > 0 ? t.seconds : ''), q(t.videoId),
        q(t.match ? YWP.resolvePath(t.match.path, state.options) : ''),
        t.match ? t.match.score.toFixed(3) : '',
      ].join(','));
    });
    return out.join(CRLF) + CRLF;
  },

  /* yt-dlp fetch script for the tracks with no local file. It writes its
     own .m3u8 afterwards from the files that actually landed on disk, so
     the paths in it are correct by construction rather than predicted. */
  ytdlpPowerShell(state) {
    const psq = s => "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'";
    const missing = exportableTracks(state).filter(t => !t.match);
    const folder  = YWP.sanitizeFilename(state.playlistName, 'playlist');
    const fmt     = ((state.options.ytdlpFormat || 'mp3').replace(/[^a-z0-9]/gi, '') || 'mp3');

    const entries = missing.map(t => {
      const name   = YWP.sanitizeFilename(displayTitle(t), 'unknown');
      const target = t.videoId
        ? 'https://www.youtube.com/watch?v=' + t.videoId
        : 'ytsearch1:' + displayTitle(t);
      const secs = (t.seconds != null && t.seconds > 0) ? t.seconds : -1;
      return '  @{ Name = ' + psq(name) + '; Target = ' + psq(target) + '; Seconds = ' + secs + ' }';
    });

    return [
      '# ' + state.playlistName + ' — fetch the tracks that are not in your library yet.',
      '#',
      '# Needs yt-dlp and ffmpeg on PATH:  winget install yt-dlp.yt-dlp ffmpeg',
      '# Downloads next to this script, then writes a .m3u8 of what arrived.',
      '#',
      '# For ONE playlist covering everything, come back to the widget afterwards and',
      '# include this folder in the step 3 listing, then re-run the match.',
      '#',
      '# Only fetch material you are entitled to keep offline.',
      '',
      '$ErrorActionPreference = ' + psq('Continue'),
      '$Dest = Join-Path $PSScriptRoot ' + psq(folder),
      'New-Item -ItemType Directory -Force -Path $Dest | Out-Null',
      '',
      '$Tracks = @(',
      entries.join(',' + CRLF),
      ')',
      '',
      'if ($Tracks.Count -eq 0) { Write-Host ' + psq('Nothing to download — every track matched a local file.') + '; return }',
      '',
      '# yt-dlp picks the container, and --audio-format best leaves it as-is, so',
      '# the finished file is found by globbing rather than by assuming .' + fmt + '.',
      'function Find-Track($name) {',
      '  Get-ChildItem -LiteralPath $Dest -File -Filter ($name + ' + psq('.*') + ') -ErrorAction SilentlyContinue |',
      '    Where-Object { $_.Extension -notin ' + psq('.part') + ', ' + psq('.ytdl') + ', ' + psq('.temp') + ' } |',
      '    Select-Object -First 1',
      '}',
      '',
      '$i = 0',
      'foreach ($t in $Tracks) {',
      '  $i++',
      '  Write-Host ("[{0}/{1}] {2}" -f $i, $Tracks.Count, $t.Name)',
      '  if (Find-Track $t.Name) { Write-Host ' + psq('    already downloaded, skipping') + '; continue }',
      '  $out = Join-Path $Dest ($t.Name + ' + psq('.%(ext)s') + ')',
      '  yt-dlp --no-playlist --extract-audio --audio-format ' + fmt + ' --audio-quality 0 `',
      '         --embed-metadata --no-overwrites --output $out -- $t.Target',
      '}',
      '',
      '# Build a playlist from whatever actually landed on disk.',
      '$m3u   = Join-Path $Dest ' + psq(folder + '.m3u8'),
      '$lines = @(' + psq('#EXTM3U') + ')',
      '$got   = 0',
      'foreach ($t in $Tracks) {',
      '  $file = Find-Track $t.Name',
      '  if ($file) {',
      '    $lines += (' + psq('#EXTINF:') + ' + $t.Seconds + ' + psq(',') + ' + $t.Name)',
      '    $lines += $file.FullName',
      '    $got++',
      '  } else {',
      '    Write-Warning ("Did not download: {0}" -f $t.Name)',
      '  }',
      '}',
      '',
      '$utf8 = New-Object System.Text.UTF8Encoding $false',
      '[System.IO.File]::WriteAllText($m3u, ($lines -join "`r`n") + "`r`n", $utf8)',
      'Write-Host ("Wrote {0} ({1} of {2} tracks)" -f $m3u, $got, $Tracks.Count)',
      '',
    ].join(CRLF);
  },

  /* Not a playlist — the snippet the user runs to produce the library
     listing that step 3 consumes. */
  libraryScanScript(extsCsv, withTags) {
    // `Get-ChildItem -Include` is unreliable when combined with -LiteralPath,
    // so the extension filter is applied with Where-Object instead.
    const exts = String(extsCsv || 'mp3')
      .split(/[,\s]+/).filter(Boolean)
      .map(e => "'." + e.replace(/^\./, '').toLowerCase() + "'").join(',');

    const header = [
      '$Root = "D:\\Music"          # <- point this at your music folder',
      '$Exts = ' + exts,
      '',
      '$files = Get-ChildItem -LiteralPath $Root -Recurse -File |',
      '  Where-Object { $Exts -contains $_.Extension.ToLower() }',
    ];

    if (!withTags) {
      return header.concat([
        '',
        '$files | Select-Object -ExpandProperty FullName | Set-Clipboard',
        'Write-Host "Copied $($files.Count) paths to the clipboard."',
      ]).join(CRLF);
    }

    return header.concat([
      '',
      '# Adds Artist and Title from each file\'s tags — slower, but it rescues',
      '# libraries whose filenames are just "01.mp3". Output: path<TAB>artist<TAB>title.',
      '$shell  = New-Object -ComObject Shell.Application',
      '$rows   = New-Object System.Collections.Generic.List[string]',
      '$iTitle = -1; $iArtist = -1',
      '',
      '$files | Group-Object DirectoryName | ForEach-Object {',
      '  $dir = $shell.NameSpace($_.Name)',
      '  if (-not $dir) { return }',
      '',
      '  # Column indices move between Windows versions, so look them up by',
      '  # name once, on the first folder, then reuse them.',
      '  if ($iTitle -lt 0 -or $iArtist -lt 0) {',
      '    foreach ($n in 0..320) {',
      '      switch ($dir.GetDetailsOf($null, $n)) {',
      '        "Title"                { $iTitle  = $n }',
      '        "Contributing artists" { $iArtist = $n }',
      '      }',
      '      if ($iTitle -ge 0 -and $iArtist -ge 0) { break }',
      '    }',
      '  }',
      '',
      '  foreach ($f in $_.Group) {',
      '    $item = $dir.ParseName($f.Name)',
      '    if (-not $item) { $rows.Add($f.FullName); continue }',
      '    $title  = if ($iTitle  -ge 0) { $dir.GetDetailsOf($item, $iTitle)  } else { "" }',
      '    $artist = if ($iArtist -ge 0) { $dir.GetDetailsOf($item, $iArtist) } else { "" }',
      '    # Explorer sprinkles bidi control marks through these values.',
      '    $clean  = { param($s) ($s -replace "[\\u200e\\u200f\\u202a-\\u202e]", "").Trim() }',
      '    $rows.Add((($f.FullName), (& $clean $artist), (& $clean $title)) -join "`t")',
      '  }',
      '}',
      '',
      '$rows -join "`r`n" | Set-Clipboard',
      'Write-Host "Copied $($rows.Count) rows to the clipboard."',
    ]).join(CRLF);
  },
};
