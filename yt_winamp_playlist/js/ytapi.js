/* ────────────────────────────────────────────────────────────
   ytapi.js — YouTube Data API v3 client for public / unlisted
   playlists.

   Works for anything a signed-out visitor could open. Private
   playlists (Liked Music, personal mixes) are invisible to an
   API-key request no matter what — those need the console grabber.

   googleapis.com serves permissive CORS headers, so these calls work
   straight from the browser with no proxy. The key is the user's own
   and never leaves this machine except in the request to Google.
   ──────────────────────────────────────────────────────────── */
window.YWP = window.YWP || {};

const API_BASE  = 'https://www.googleapis.com/youtube/v3/';
const PAGE_SIZE = 50;    // the API's hard maximum for these endpoints

async function apiGet(endpoint, params, key) {
  const url = new URL(API_BASE + endpoint);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', key);

  const res = await fetch(url.toString());
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body && body.error;
    const reason = err && err.errors && err.errors[0] && err.errors[0].reason;
    const detail = (err && err.message) || res.statusText;
    if (reason === 'playlistNotFound') {
      throw new Error('Playlist not found. Private playlists are not reachable with an API key — use the console grabber instead.');
    }
    if (reason === 'quotaExceeded') {
      throw new Error('This API key is out of quota for today.');
    }
    if (res.status === 400 || res.status === 403) {
      throw new Error('YouTube rejected the request (' + (reason || res.status) + '): ' + detail);
    }
    throw new Error('YouTube API error ' + res.status + ': ' + detail);
  }
  return body;
}

/* Video titles come from playlistItems, but durations only exist on the
   videos endpoint — so ids are batched back through it 50 at a time. */
async function fetchDurations(videoIds, key) {
  const byId = new Map();
  for (let i = 0; i < videoIds.length; i += PAGE_SIZE) {
    const chunk = videoIds.slice(i, i + PAGE_SIZE).filter(Boolean);
    if (!chunk.length) continue;
    const body = await apiGet('videos', { part: 'contentDetails', id: chunk.join(','), maxResults: PAGE_SIZE }, key);
    for (const item of (body.items || [])) {
      byId.set(item.id, YWP.parseIsoDuration(item.contentDetails && item.contentDetails.duration));
    }
  }
  return byId;
}

/* Placeholders the API returns for videos that are gone. They carry no
   usable title, so they are dropped rather than exported as dead rows. */
const DEAD_TITLES = /^(deleted video|private video|\[deleted video\]|\[private video\])$/i;

YWP.ytapi = {
  /* onProgress(loadedCount) is called after each page so the UI can count up. */
  async fetchPlaylist(playlistId, key, onProgress) {
    if (!playlistId) throw new Error('No playlist id — paste a playlist URL or its id.');
    if (!key) throw new Error('No API key. Create one in Google Cloud Console with the YouTube Data API v3 enabled.');

    let name = '';
    try {
      const meta = await apiGet('playlists', { part: 'snippet', id: playlistId, maxResults: 1 }, key);
      name = (meta.items && meta.items[0] && meta.items[0].snippet && meta.items[0].snippet.title) || '';
    } catch (e) {
      // A missing playlists-endpoint result is not fatal; the items call
      // below gives the real verdict on whether the playlist is readable.
    }

    const raw = [];
    let pageToken = '';
    do {
      const params = { part: 'snippet,contentDetails', playlistId, maxResults: PAGE_SIZE };
      if (pageToken) params.pageToken = pageToken;
      const body = await apiGet('playlistItems', params, key);

      for (const item of (body.items || [])) {
        const sn = item.snippet || {};
        if (DEAD_TITLES.test((sn.title || '').trim())) continue;
        raw.push({
          title:   sn.title || '',
          channel: sn.videoOwnerChannelTitle || sn.channelTitle || '',
          videoId: (item.contentDetails && item.contentDetails.videoId) || sn.resourceId && sn.resourceId.videoId || '',
        });
      }
      if (onProgress) onProgress(raw.length);
      pageToken = body.nextPageToken || '';
    } while (pageToken);

    const durations = await fetchDurations(raw.map(r => r.videoId), key);

    return {
      playlistName: name || 'YouTube Playlist',
      tracks: raw.map(r => YWP.makeTrack({
        title:   r.title,
        channel: r.channel,
        videoId: r.videoId,
        seconds: durations.has(r.videoId) ? durations.get(r.videoId) : -1,
      })),
    };
  },
};
