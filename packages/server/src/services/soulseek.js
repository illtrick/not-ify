'use strict';

/**
 * Soulseek search via slskd REST API.
 * slskd runs as a Docker sidecar and exposes a REST API on port 5030.
 * Searches are async — POST to create, then poll for results.
 *
 * Strategy cascade (94% hit rate across 100-album test):
 *   1. artist-only     — broadest net, 67% alone
 *   2. exact           — artist + album, +18% marginal
 *   3. ultra-short     — first word of artist + longest album word, +4%
 *   4. album-artist    — reversed order, +2%
 *   5. artist+albumword — artist + longest album word, +2%
 *   6. stripped         — no punctuation, +1%
 */

const { cleanSearchQuery } = require('./query-utils');

const SLSKD_URL = process.env.SLSKD_URL || 'http://slskd:5030';
const SEARCH_TIMEOUT = 15000; // max time to wait for results
const POLL_INTERVAL = 2000;
const CASCADE_COOLDOWN = 1500; // ms between cascade attempts to avoid rate-limiting

/**
 * Search Soulseek for music files.
 * Returns array of { username, fileCount, files[] } responses.
 *
 * @param {string} query - search text
 * @param {object} [opts]
 * @param {number} [opts.timeout] - max wait in ms (default 15s)
 * @param {number} [opts.minResults] - stop early if we hit this many responses (default 10)
 * @returns {Promise<{ responseCount, fileCount, responses[] }>}
 */
async function searchSoulseek(query, opts = {}) {
  const timeout = opts.timeout || SEARCH_TIMEOUT;
  const minResults = opts.minResults || 10;

  try {
    // Start search
    const startRes = await fetch(`${SLSKD_URL}/api/v0/searches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ searchText: query }),
      signal: AbortSignal.timeout(5000),
    });

    if (!startRes.ok) {
      console.error(`[soulseek] Search start failed: ${startRes.status}`);
      return { responseCount: 0, fileCount: 0, responses: [] };
    }

    const search = await startRes.json();
    const searchId = search.id;

    // Poll for results
    const deadline = Date.now() + timeout;
    let result = search;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));

      const pollRes = await fetch(`${SLSKD_URL}/api/v0/searches/${searchId}`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!pollRes.ok) break;
      result = await pollRes.json();

      // Stop if complete or we have enough responses
      if (result.isComplete || result.responseCount >= minResults) break;
    }

    // Stop the search if it hasn't completed naturally — slskd only populates
    // the /responses sub-endpoint once the search is in a terminal state.
    if (!result.isComplete) {
      try {
        await fetch(`${SLSKD_URL}/api/v0/searches/${searchId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isComplete: true }),
          signal: AbortSignal.timeout(3000),
        });
        // Brief pause for slskd to finalize responses
        await new Promise(r => setTimeout(r, 500));
      } catch {}
    }

    // Fetch full responses with file details (main endpoint omits files)
    let responses = [];
    try {
      const respRes = await fetch(`${SLSKD_URL}/api/v0/searches/${searchId}/responses`, {
        signal: AbortSignal.timeout(5000),
      });
      if (respRes.ok) {
        responses = await respRes.json();
      }
    } catch {}

    // Clean up the search on slskd
    try {
      await fetch(`${SLSKD_URL}/api/v0/searches/${searchId}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(3000),
      });
    } catch {}

    return {
      responseCount: result.responseCount || 0,
      fileCount: result.fileCount || 0,
      responses: (responses || []).map(r => ({
        username: r.username,
        fileCount: r.fileCount || 0,
        hasFreeSlot: r.hasFreeUploadSlot,
        speed: r.uploadSpeed,
        files: (r.files || []).map(f => ({
          filename: f.filename,
          size: f.size,
          bitRate: f.bitRate,
          sampleRate: f.sampleRate,
          bitDepth: f.bitDepth,
        })),
      })),
    };
  } catch (err) {
    console.error(`[soulseek] Search error: ${err.message}`);
    return { responseCount: 0, fileCount: 0, responses: [] };
  }
}

/**
 * Check if slskd is connected to the Soulseek network.
 */
async function checkHealth() {
  try {
    const res = await fetch(`${SLSKD_URL}/api/v0/server`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const state = await res.json();
    return state.isConnected && state.isLoggedIn;
  } catch {
    return false;
  }
}

/**
 * Build cascade query variants in optimal order.
 * Returns array of { strategy, query } — null queries are skipped.
 */
function buildCascadeQueries(artist, album) {
  const cleaned = cleanSearchQuery(album);
  const artistFirst = artist.split(/\s+/)[0];
  const albumSource = cleaned || album;
  // Strip punctuation from individual words before filtering
  const albumWords = albumSource.split(/\s+/)
    .map(w => w.replace(/[^a-zA-Z0-9\u00C0-\u024F]/g, ''))
    .filter(w => w.length > 2);
  const longestAlbumWord = albumWords.sort((a, b) => b.length - a.length)[0];

  return [
    { strategy: 'artist-only', query: artist },
    { strategy: 'exact', query: `${artist} ${album}` },
    { strategy: 'ultra-short', query: artistFirst && longestAlbumWord ? `${artistFirst} ${longestAlbumWord}` : null },
    { strategy: 'album-artist', query: `${cleaned || album} ${artist}` },
    { strategy: 'artist+albumword', query: longestAlbumWord ? `${artist} ${longestAlbumWord}` : null },
    { strategy: 'stripped', query: `${artist} ${album}`.replace(/[:\-–—&!?.,;'"()\[\]{}]/g, ' ').replace(/\s+/g, ' ').trim() },
  ].filter(e => e.query);
}

/**
 * Search Soulseek using the optimized strategy cascade.
 * Tries strategies in order, stopping at the first one that returns results.
 *
 * @param {string} artist
 * @param {string} album
 * @param {object} [opts]
 * @param {number} [opts.timeout] - per-strategy timeout in ms (default 15s)
 * @param {number} [opts.minResults] - stop polling early per strategy (default 10)
 * @returns {Promise<{ strategy, responseCount, fileCount, responses[] }>}
 */
async function searchSoulseekCascade(artist, album, opts = {}) {
  const queries = buildCascadeQueries(artist, album);

  for (const { strategy, query } of queries) {
    const result = await searchSoulseek(query, opts);
    if (result.responseCount > 0) {
      return { strategy, ...result };
    }
    // Cooldown between attempts to avoid Soulseek rate-limiting
    await new Promise(r => setTimeout(r, CASCADE_COOLDOWN));
  }

  return { strategy: 'none', responseCount: 0, fileCount: 0, responses: [] };
}

/**
 * Enqueue files for download from a Soulseek peer.
 *
 * @param {string} username - the peer's username
 * @param {Array<{filename: string, size: number}>} files - files to download
 * @returns {Promise<boolean>} true on success, false on failure
 */
async function enqueueDownload(username, files) {
  try {
    const res = await fetch(`${SLSKD_URL}/api/v0/transfers/downloads/${encodeURIComponent(username)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(files),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error(`[soulseek] Enqueue download failed: ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[soulseek] Enqueue error: ${err.message}`);
    return false;
  }
}

/**
 * Poll the transfer state for all downloads from a given peer.
 *
 * @param {string} username - the peer's username
 * @returns {Promise<Array>} transfer state objects, or [] on failure
 */
async function pollDownloads(username) {
  try {
    const res = await fetch(
      `${SLSKD_URL}/api/v0/transfers/downloads/${encodeURIComponent(username)}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    // Per-user endpoint returns a single object {username, directories},
    // not an array. Normalize to array for consistent iteration.
    return Array.isArray(data) ? data : [data];
  } catch {
    return [];
  }
}

/**
 * List files in the slskd downloads directory.
 *
 * @returns {Promise<Array>} file listing, or [] on failure
 */
async function getDownloadedFiles() {
  try {
    const res = await fetch(`${SLSKD_URL}/api/v0/files/downloads`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

module.exports = { searchSoulseek, searchSoulseekCascade, buildCascadeQueries, checkHealth, enqueueDownload, pollDownloads, getDownloadedFiles };
