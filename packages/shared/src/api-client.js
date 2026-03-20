/**
 * Configurable API client for Not-ify.
 *
 * Web (Docker-served): uses relative URLs — baseUrl = ''
 * Tauri desktop app: uses absolute server URL — baseUrl = 'http://192.168.1.50:3000'
 */

const enc = encodeURIComponent;

let _baseUrl = '';
let _userId = null;

// The API version this client expects — bump when making breaking API changes
const CLIENT_API_VERSION = 1;

let _versionMismatchCallback = null;

export function configure({ baseUrl, onVersionMismatch }) {
  _baseUrl = (baseUrl || '').replace(/\/$/, '');
  if (onVersionMismatch) _versionMismatchCallback = onVersionMismatch;
}

export function setUser(userId) {
  _userId = userId;
}

export function getUser() {
  return _userId;
}

export function getBaseUrl() {
  return _baseUrl;
}

/**
 * Check server health and API version compatibility.
 * Returns { compatible, serverVersion, serverApiVersion, clientApiVersion }
 */
export async function checkHealth() {
  try {
    const data = await get('/api/health');
    const compatible = data.apiVersion === CLIENT_API_VERSION;
    if (!compatible && _versionMismatchCallback) {
      _versionMismatchCallback({
        serverVersion: data.version,
        serverApiVersion: data.apiVersion,
        clientApiVersion: CLIENT_API_VERSION,
      });
    }
    return {
      compatible,
      serverVersion: data.version,
      serverApiVersion: data.apiVersion,
      clientApiVersion: CLIENT_API_VERSION,
    };
  } catch (err) {
    return { compatible: false, error: err.message };
  }
}

export async function request(path, options = {}) {
  const url = `${_baseUrl}${path}`;
  const headers = { ...options.headers };

  // Inject user identification header
  if (_userId) headers['X-User-Id'] = _userId;

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    const error = new Error(`API ${response.status}: ${response.statusText}`);
    error.status = response.status;
    try {
      error.body = await response.json();
    } catch {}
    throw error;
  }

  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return response.json();
  }
  return response;
}

export function get(path, options = {}) {
  return request(path, { ...options, method: 'GET' });
}

export function post(path, body, options = {}) {
  return request(path, {
    ...options,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: JSON.stringify(body),
  });
}

export function del(path, options = {}) {
  return request(path, { ...options, method: 'DELETE' });
}

export function put(path, body, options = {}) {
  return request(path, {
    ...options,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Raw fetch helpers — for SSE / streaming endpoints where we need the raw
// Response object (not auto-parsed JSON).
// ---------------------------------------------------------------------------

export async function rawPost(path, body, options = {}) {
  const url = `${_baseUrl}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (_userId) headers['X-User-Id'] = _userId;
  return fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    ...options,
  });
}

export async function rawGet(path, options = {}) {
  const url = `${_baseUrl}${path}`;
  const headers = {};
  if (_userId) headers['X-User-Id'] = _userId;
  return fetch(url, { ...options, headers: { ...headers, ...options.headers } });
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

export function getLibrary() {
  return get('/api/library');
}

export function streamUrl(id) {
  return `${_baseUrl}/api/stream/${id}`;
}

export function removeAlbum(artist, album) {
  return request('/api/library/album', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ artist, album }),
  });
}

export function removeTrack(id) {
  return del(`/api/library/track/${id}`);
}

export function dedupeLibrary() {
  return post('/api/library/dedupe');
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export function search(q) {
  return get(`/api/search?q=${enc(q)}`);
}

// ---------------------------------------------------------------------------
// MusicBrainz
// ---------------------------------------------------------------------------

export function getMbReleaseTracks(mbid) {
  return get(`/api/mb/release/${mbid}/tracks`);
}

export function getMbRgTracks(rgid) {
  return get(`/api/mb/release-group/${rgid}/tracks`);
}

// ---------------------------------------------------------------------------
// MB track prefetch cache — populated on album hover, consumed by useMbTracks
// ---------------------------------------------------------------------------

const prefetchCache = new Map();

export function prefetchMbTracks(mbid, rgid) {
  const key = mbid || rgid;
  if (!key || prefetchCache.has(key)) return;
  const promise = mbid ? getMbReleaseTracks(mbid) : getMbRgTracks(rgid);
  prefetchCache.set(key, promise);
}

export function getCachedMbTracks(key) {
  return prefetchCache.get(key) || null;
}

// ---------------------------------------------------------------------------
// Cover
// ---------------------------------------------------------------------------

export function getCoverColor(path) {
  return get(path);
}

export function getCoverSearchColor(artist, album) {
  return get(`/api/cover/search/color?artist=${enc(artist)}&album=${enc(album)}`);
}

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------

export function ytSearch(q) {
  return get(`/api/yt/search?q=${enc(q)}`);
}

export function ytStreamUrl(videoId) {
  return `${_baseUrl}/api/yt/stream/${videoId}`;
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

export function startDownload(body) {
  return rawPost('/api/download', body);
}

export function cancelDownload() {
  return del('/api/download');
}

export function startBgDownload(body) {
  return post('/api/download/background', body);
}

export function getBgStatus() {
  return get('/api/download/background/status');
}

export function startYtDownload(body) {
  return rawPost('/api/download/yt', body);
}

export function batchYtDownload(body) {
  return post('/api/download/yt/batch', body);
}

export function startYtAlbumDownload(body) {
  return post('/api/download/yt/album', body);
}

export function getYtQueue() {
  return get('/api/download/yt/queue');
}

export function cancelYtDownload() {
  return del('/api/download/yt');
}

// ---------------------------------------------------------------------------
// Artist
// ---------------------------------------------------------------------------

export function getArtist(mbid, name) {
  return get(`/api/artist/${mbid}?name=${enc(name)}`);
}

export function artistImageUrl(name) {
  return `${_baseUrl}/api/artist/image?name=${enc(name)}`;
}

export function getRecordingLookup(artist, track) {
  return get(`/api/recording/lookup?artist=${enc(artist)}&track=${enc(track)}`);
}

// ---------------------------------------------------------------------------
// Wiki
// ---------------------------------------------------------------------------

export function getWikiSummary(url) {
  return get(`/api/wiki/summary?url=${enc(url)}`);
}

// ---------------------------------------------------------------------------
// Last.fm
// ---------------------------------------------------------------------------

export function getLastfmStatus() {
  return get('/api/lastfm/status');
}

export function getLastfmTopArtists(period, limit) {
  return get(`/api/lastfm/top/artists?period=${period || '12month'}&limit=${limit || 20}`);
}

export function getLastfmTopTracks(name, limit) {
  return get(`/api/lastfm/artist/top-tracks?artist=${enc(name)}&limit=${limit || 10}`);
}

export function lastfmNowPlaying(body) {
  return post('/api/lastfm/nowplaying', body);
}

export function lastfmScrobble(body) {
  return post('/api/lastfm/scrobble', body);
}

export function lastfmSaveConfig(body) {
  return post('/api/lastfm/config', body);
}

export function lastfmGetAuthToken() {
  return get('/api/lastfm/auth/token');
}

export function lastfmCompleteAuth(token) {
  return post('/api/lastfm/auth/session', { token });
}

export function lastfmDisconnect() {
  return post('/api/lastfm/disconnect');
}

// ---------------------------------------------------------------------------
// Recently Played
// ---------------------------------------------------------------------------

export function getRecentlyPlayed() {
  return get('/api/recently-played');
}

export function addRecentlyPlayed(item) {
  return post('/api/recently-played', item);
}

export function setRecentlyPlayed(list) {
  return put('/api/recently-played', list);
}

export function recentlyPlayedStreamUrl() {
  const base = `${_baseUrl}/api/recently-played/stream`;
  // SSE doesn't support custom headers, so pass userId as query param
  return _userId ? `${base}?userId=${_userId}` : base;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export function getAvailableUsers() {
  return get('/api/users');
}

// ---------------------------------------------------------------------------
// Search History (per-user, server-side)
// ---------------------------------------------------------------------------

export function getSearchHistory() {
  return get('/api/search-history');
}

export function addSearchHistoryEntry(query) {
  return post('/api/search-history', { query });
}

export function removeSearchHistoryEntry(query) {
  return request('/api/search-history', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
}

// ---------------------------------------------------------------------------
// Favorites (per-user)
// ---------------------------------------------------------------------------

export function getFavorites() {
  return get('/api/favorites');
}

export function addFavoriteTrack({ trackId, artist, album, title }) {
  return post('/api/favorites', { trackId, artist, album, title });
}

export function removeFavoriteTrack(trackId) {
  return del(`/api/favorites/${trackId}`);
}

// ---------------------------------------------------------------------------
// Session (per-user, server-side)
// ---------------------------------------------------------------------------

export function getUserSession() {
  return get('/api/session');
}

export function saveUserSession({ queue, state }) {
  return put('/api/session', { queue, state });
}

// ---------------------------------------------------------------------------
// Settings (per-user)
// ---------------------------------------------------------------------------

export function getUserSettings() {
  return get('/api/settings');
}

export function saveUserSettings(settings) {
  return put('/api/settings', settings);
}

// ---------------------------------------------------------------------------
// Cast (DLNA/UPnP)
// ---------------------------------------------------------------------------

export function getCastDevices() {
  return get('/api/cast/devices');
}

export function castPlay(body) {
  return post('/api/cast/play', body);
}

export function castPlayYt(body) {
  return post('/api/cast/play/yt', body);
}

export function castPause(deviceUsn) {
  return post('/api/cast/pause', { deviceUsn });
}

export function castStop(deviceUsn) {
  return post('/api/cast/stop', { deviceUsn });
}

export function castSeek(deviceUsn, position) {
  return post('/api/cast/seek', { deviceUsn, position });
}

export function castVolume(deviceUsn, level) {
  return post('/api/cast/volume', { deviceUsn, level });
}

export function castStatus(deviceUsn) {
  return get(`/api/cast/status?deviceUsn=${enc(deviceUsn)}`);
}

export function castNext(deviceUsn) {
  return post('/api/cast/next', { deviceUsn });
}

export function castPrev(deviceUsn) {
  return post('/api/cast/prev', { deviceUsn });
}

export function castStatusStreamUrl(deviceUsn) {
  const base = `${_baseUrl}/api/cast/status/stream?deviceUsn=${enc(deviceUsn)}`;
  return _userId ? `${base}&userId=${enc(_userId)}` : base;
}

// ---------------------------------------------------------------------------
// Upgrade / Job Queue
// ---------------------------------------------------------------------------

export function getJobQueue() {
  return get('/api/upgrade/status');
}

export function triggerAlbumUpgrade(artist, album) {
  return post('/api/upgrade/album', { artist, album });
}

export function triggerLibraryScan() {
  return post('/api/upgrade/scan');
}

// ---------------------------------------------------------------------------
// Real-Debrid Config
// ---------------------------------------------------------------------------

export function getRdStatus() {
  return get('/api/realdebrid/status');
}

export function saveRdConfig(body) {
  return post('/api/realdebrid/config', body);
}

export function testRdConnection() {
  return post('/api/realdebrid/test');
}

// ---------------------------------------------------------------------------
// VPN Config
// ---------------------------------------------------------------------------

export function getVpnStatus() {
  return get('/api/vpn/status');
}

export function getVpnRegions() {
  return get('/api/vpn/regions');
}

export function saveVpnConfig(body) {
  return post('/api/vpn/config', body);
}

export function testVpnConnection() {
  return post('/api/vpn/test');
}
