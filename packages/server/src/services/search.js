const APIBAY_BASE = 'https://apibay.org';

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

async function searchMusic(query) {
  try {
    const url = `${APIBAY_BASE}/q.php?q=${encodeURIComponent(query)}&cat=100`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });

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

    return results;
  } catch (err) {
    console.error(`Search failed: ${err.message}`);
    return [];
  }
}

module.exports = { searchMusic };
