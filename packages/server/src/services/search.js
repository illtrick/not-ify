const { ProxyAgent, fetch: undiciFetch } = require('undici');

const APIBAY_BASE = 'https://apibay.org';

function getProxyFetch() {
  const proxy = process.env.VPN_PROXY || '';
  if (!proxy) return fetch;
  const dispatcher = new ProxyAgent(proxy);
  return (url, opts) => undiciFetch(url, { ...opts, dispatcher });
}

const torrentCache = new Map();
const TORRENT_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

async function searchMusic(query) {
  const cacheKey = query.toLowerCase().trim();
  const cached = torrentCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  try {
    const url = `${APIBAY_BASE}/q.php?q=${encodeURIComponent(query)}&cat=100`;
    const proxyFetch = getProxyFetch();
    const res = await proxyFetch(url, { signal: AbortSignal.timeout(10000) });

    if (!res.ok) {
      console.error(`ApiBay returned ${res.status}`);
      return [];
    }

    const data = await res.json();

    // ApiBay returns [{"id":"0","name":"No results..."}] when no results
    if (!Array.isArray(data) || data.length === 0) return [];
    if (data.length === 1 && data[0].id === '0') return [];

    const results = data
      .filter(item => parseInt(item.seeders, 10) > 0)
      .map(item => ({
        id: `apibay_${item.id}`,
        name: item.name,
        magnetLink: `magnet:?xt=urn:btih:${item.info_hash}&dn=${encodeURIComponent(item.name)}`,
        seeders: parseInt(item.seeders, 10),
        leechers: parseInt(item.leechers, 10),
        size: parseInt(item.size, 10),
        sizeFormatted: formatBytes(parseInt(item.size, 10)),
        source: 'apibay',
      }))
      .sort((a, b) => b.seeders - a.seeders);

    torrentCache.set(cacheKey, { data: results, expires: Date.now() + TORRENT_CACHE_TTL });
    return results;
  } catch (err) {
    console.error(`Search failed: ${err.message}`);
    return [];
  }
}

module.exports = { searchMusic };
