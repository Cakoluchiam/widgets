# YouTube → Winamp

Turns a YouTube Music playlist into an `.m3u8` (or `.pls`) that Winamp can load — so you can
play it with Winamp's crossfade instead of YouTube's hard cuts.

## The thing worth knowing up front

Winamp plays **files on your disk**. It cannot stream YouTube. So a playlist export is really two
jobs, and this widget does both:

1. get the track list out of YouTube, and
2. point each track at a real file on your machine.

If you already own most of the music, step 2 is automatic — paste a listing of your music folder
and the fuzzy matcher does the rest. For whatever is left over, the widget writes a `yt-dlp`
script that fetches those tracks and generates a matching playlist.

## Using it

### 1 — Get the playlist out of YouTube

Three routes, in order of how well they work:

| Route | Works for | Needs |
|---|---|---|
| **Console grabber** | Any playlist you can see, **including private ones** | Pasting a snippet into the browser console |
| **API key** | Public and unlisted playlists | Your own YouTube Data API v3 key |
| **Paste** | Anything you can copy as text | Nothing |

The **console grabber** is the one to reach for. It runs inside your already-signed-in YouTube
tab, so private playlists and Liked Music work without any OAuth dance, and nothing is sent to a
server. It auto-scrolls to load the whole list, reads title/artist/album/duration/video-id off
each row, and copies the result to your clipboard as JSON. Paste that back into the widget.

> First time you paste into Chrome's or Edge's console it refuses and asks you to type
> `allow pasting`. Do that once and it stops nagging.

The **paste** route understands the shapes people actually end up with: `Artist - Title`,
`Song • Artist • Album • 3:47`, tab-separated columns, numbered lists, and YouTube Music's own
one-field-per-line copy output.

Titles get cleaned on the way in — `(Official Music Video)`, `[HD]`, `(Lyrics)`, leading track
numbers and so on. Things that actually change *which recording you want* are kept, so
`(Live Aid 1985)`, `(Acoustic)` and `(Darude Remix)` all survive.

### 2 — Check the tracks

Everything is editable in place. Drag the `⠿` handle to reorder, `×` to remove, and there are
sort/shuffle buttons for building a mix. Your list is kept in `localStorage`, so a reload does not
lose it.

### 3 — Point it at your music

Copy the generated PowerShell one-liner, run it, paste the clipboard back. That is it:

```powershell
$Root = "D:\Music"
$Exts = '.mp3','.m4a','.flac','.ogg','.opus','.wav','.wma','.aac','.mpc','.ape','.wv'

$files = Get-ChildItem -LiteralPath $Root -Recurse -File |
  Where-Object { $Exts -contains $_.Extension.ToLower() }

$files | Select-Object -ExpandProperty FullName | Set-Clipboard
```

There is a **Read Artist/Title tags too** variant that pulls tags out of Windows' own metadata
store. It is slower, but it rescues libraries whose filenames are just `01.mp3`.

Alternatively, **Pick a folder** uses the browser's directory picker. It needs a Chromium browser
served over `http://localhost` (the API does not exist on `file://`) and it only yields paths
*relative* to the folder you pick, so you have to supply a path prefix in step 4.

Matching is fuzzy and shows its confidence. Anything it is unsure about is flagged amber; open the
dropdown to pick from the runners-up, or choose **Type a path…** to enter one by hand. A path you
choose yourself is pinned and survives a re-match.

### 4 — Export

| Button | Use it for |
|---|---|
| `.m3u8` | **The default.** Extended M3U, UTF-8 — handles non-ASCII artist names properly. |
| `.m3u` | Identical bytes, different extension, for anything that refuses `.m3u8`. |
| `.pls` | Winamp's original INI-shaped format. |
| `.csv` | Not for Winamp — an escape hatch into other tools. |
| `-fetch.ps1` | `yt-dlp` script for the tracks with no local file. |

Everything is written with CRLF line endings and backslash separators by default.

Tracks with no matched file are still written out, pointing at a plausible filename, so Winamp
shows you exactly what is missing rather than quietly shortening the playlist. Tick **Leave out
tracks with no file** if you would rather they were dropped.

The `-fetch.ps1` script downloads only the unmatched tracks (by video id, falling back to a
`ytsearch1:` query), skips anything already downloaded, and then writes its own `.m3u8` from the
files that actually landed — so the paths in it are correct by construction. It needs `yt-dlp` and
`ffmpeg` on `PATH` (`winget install yt-dlp.yt-dlp ffmpeg`). Only fetch material you are entitled to
keep offline.

That leaves you with two playlists. To end up with one, come back here afterwards, include the
download folder in the step 3 listing, and re-run the match — the newly downloaded files then match
like anything else.

## Turning on crossfade in Winamp

This is the part the playlist cannot do for you. Crossfading lives in Winamp's **output plugin**,
so it is a one-time setup that then applies to every playlist you load.

1. <kbd>Ctrl</kbd>+<kbd>P</kbd> for Preferences.
2. **Plug-ins → Output**.
3. Select **Nullsoft DirectSound Output** (`out_ds.dll`) and click **Configure**. This matters —
   the older WaveOut plugin cannot crossfade at all.
4. On the **Fading** tab each action has its own setting:
   - **on end of song** — tick *Enabled* and *Use custom fade time*, set ~**3000 ms**. This is the
     one that actually crossfades track to track.
   - **on start** — leave disabled, or tracks fade in over the outgoing one and the overlap sounds
     muddy.
   - **on manual song change** — enable if you want skips to blend too.
   - **on pause/stop** — 200–500 ms avoids clicks.
5. On the **Buffering** tab, raise the buffer length so the plugin has room to hold both tracks
   (max 20000 ms).

Labels shift slightly between Winamp versions, but the Fading tab and its per-action rows have been
in the DirectSound plugin for a very long time.

Then load the playlist with **File → Open Playlist**, or drag the `.m3u8` onto the playlist editor.

### If it still doesn't blend

- Crossfade needs the next file buffered ahead, so it works on local files, not streamed URLs.
- A track Winamp cannot find is skipped instantly, which reads as a gap — that is what step 3 is
  for.
- If gapless-encoded albums sound abrupt, the fade may be longer than the silence at the track
  edges. Try 2000 ms.

## Running locally

No build step — plain HTML/CSS/JS.

```bash
python -m http.server 8766
```

Then open `http://localhost:8766/yt_winamp_playlist/`.

Opening `index.html` directly over `file://` also works for everything except the directory
picker, which browsers only expose in a secure context.

## Architecture

Global-namespace pattern (`window.YWP`) with plain `<script>` tags, matching `finger_paint` — this
is what keeps `file://` working, since ES modules are blocked there.

| File | Role |
|---|---|
| `js/core.js` | State, `localStorage` persistence, duration/filename helpers |
| `js/parse.js` | Title cleanup, artist/title splitting, pasted-text parsing |
| `js/grabber.js` | The console snippet — one source of truth, the copyable text is derived from it with `Function.prototype.toString()` |
| `js/ytapi.js` | YouTube Data API v3 client |
| `js/library.js` | Library indexing and the fuzzy matcher |
| `js/exporters.js` | M3U/PLS/CSV/PowerShell generation |
| `js/ui.js` | Table rendering, inline editing, drag reorder |
| `js/app.js` | Event wiring |

**How matching works.** Two stages, so it scales to a large library. An inverted token index
narrows tens of thousands of files to a few hundred plausible candidates; those are then rescored
with a character-bigram Dice similarity that copes with tokenisation the first pass gets wrong
(punctuation glued to words, CJK titles with no spaces). Title tokens are matched against the
filename, artist tokens against filename *and* the two enclosing folders, since the artist is
usually a directory rather than part of the name. Filename precision is measured against tokens
the query cannot account for, so `01 - Radiohead - Creep.mp3` is not penalised for being verbose.

Only paths are read, never file contents, so indexing 20,000 files takes about half a second.

## Limitations

- **Durations are not used for matching.** A path listing carries no duration, so a live version
  of the right length cannot be told from a studio one by timing alone. The candidate dropdown is
  there for those.
- **The folder index is not persisted** — it can be tens of thousands of entries. Your tracks and
  their matches are; re-paste the listing if you want to match again in a later session.
- **The API-key route cannot see private playlists.** That is a YouTube restriction, not a bug —
  use the console grabber.
- **The grabber reads the rendered page**, so it will need updating whenever YouTube reshuffles
  its DOM. It handles both `music.youtube.com` and `youtube.com` playlist pages today.
