'use strict';

const { getProxyFetch, recordFailure } = require('./proxy');

const SOLIDTORRENTS_BASE = 'https://solidtorrents.to/api/v1';

const torrentCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

async function searchSolidTorrents(query) {
  const cacheKey = `solid:${query.toLowerCase().trim()}`;
  const cached = torrentCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  try {
    const url = `${SOLIDTORRENTS_BASE}/search?q=${encodeURIComponent(query)}&category=Audio`;
    const proxyFetch = getProxyFetch();
    const res = await proxyFetch(url, { signal: AbortSignal.timeout(10000) });

    if (!res.ok) {
      console.error(`SolidTorrents returned ${res.status}`);
      return [];
    }

    const data = await res.json();

    if (!data.success || !Array.isArray(data.results) || data.results.length === 0) {
      return [];
    }

    const results = data.results
      .filter(item => (item.seeders || 0) > 0)
      .map(item => ({
        id: `solid_${item.infohash}`,
        name: item.title,
        magnetLink: `magnet:?xt=urn:btih:${item.infohash}&dn=${encodeURIComponent(item.title)}`,
        seeders: item.seeders || 0,
        leechers: item.leechers || 0,
        size: item.size || 0,
        sizeFormatted: formatBytes(item.size || 0),
        source: 'solidtorrents',
      }))
      .sort((a, b) => b.seeders - a.seeders);

    torrentCache.set(cacheKey, { data: results, expires: Date.now() + CACHE_TTL });
    return results;
  } catch (err) {
    console.error(`SolidTorrents search failed: ${err.message}`);
    recordFailure('solidtorrents', err.message);
    return [];
  }
}

module.exports = { searchSolidTorrents };
