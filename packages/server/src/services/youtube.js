const { spawn } = require('child_process');
// NOTE: yt-dlp intentionally does NOT route through VPN proxy.
// YouTube aggressively blocks VPN IPs ("Sign in to confirm you're not a bot").
// Streaming from YouTube doesn't need privacy protection — only torrent search
// and RealDebrid API calls are sensitive.

// In-memory caches
const searchCache = new Map();
const urlCache = new Map();
const SEARCH_TTL = 5 * 60 * 1000; // 5 min
const URL_TTL = 30 * 60 * 1000; // 30 min

// Concurrency limiter
let activeProcesses = 0;
const MAX_CONCURRENT = 2;

function waitForSlot() {
  return new Promise(resolve => {
    const check = () => {
      if (activeProcesses < MAX_CONCURRENT) { activeProcesses++; resolve(); }
      else setTimeout(check, 200);
    };
    check();
  });
}

async function searchYouTube(query, limit = 15) {
  const cacheKey = `${query}::${limit}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < SEARCH_TTL) return cached.data;

  await waitForSlot();
  try {
    return await new Promise((resolve, reject) => {
      const args = [`ytsearch${limit}:${query}`, '--flat-playlist', '--dump-json', '--no-download', '--no-warnings'];
      const proc = spawn('yt-dlp', args, { timeout: 15000 });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', d => stdout += d);
      proc.stderr.on('data', d => stderr += d);
      proc.on('close', code => {
        if (code !== 0) return reject(new Error(stderr || `yt-dlp exited ${code}`));
        const results = stdout.trim().split('\n').filter(Boolean).map(line => {
          try { return JSON.parse(line); } catch { return null; }
        }).filter(Boolean).map(r => ({
          id: r.id,
          title: r.title,
          duration: r.duration,
          channel: r.channel || r.uploader,
          thumbnail: r.thumbnail || r.thumbnails?.[0]?.url,
          url: r.webpage_url || r.url,
        }));
        searchCache.set(cacheKey, { data: results, ts: Date.now() });
        resolve(results);
      });
      proc.on('error', reject);
    });
  } finally {
    activeProcesses--;
  }
}

async function getStreamUrl(videoId) {
  const cached = urlCache.get(videoId);
  if (cached && Date.now() - cached.ts < URL_TTL) return cached.data;

  await waitForSlot();
  try {
    return await new Promise((resolve, reject) => {
      const proc = spawn('yt-dlp', ['--get-url', '-f', 'bestaudio', '--no-warnings', `https://www.youtube.com/watch?v=${videoId}`], { timeout: 10000 });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', d => stdout += d);
      proc.stderr.on('data', d => stderr += d);
      proc.on('close', code => {
        if (code !== 0) return reject(new Error(stderr || `yt-dlp exited ${code}`));
        const url = stdout.trim();
        if (!url) return reject(new Error('No URL returned'));
        urlCache.set(videoId, { data: url, ts: Date.now() });
        resolve(url);
      });
      proc.on('error', reject);
    });
  } finally {
    activeProcesses--;
  }
}

async function searchSoundCloud(query, limit = 10) {
  const cacheKey = `sc:${query}::${limit}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < SEARCH_TTL) return cached.data;

  await waitForSlot();
  try {
    return await new Promise((resolve, reject) => {
      const args = [`scsearch${limit}:${query}`, '--flat-playlist', '--dump-json', '--no-download', '--no-warnings'];
      const proc = spawn('yt-dlp', args, { timeout: 15000 });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', d => stdout += d);
      proc.stderr.on('data', d => stderr += d);
      proc.on('close', code => {
        if (code !== 0) { resolve([]); return; } // SoundCloud search can fail silently
        const results = stdout.trim().split('\n').filter(Boolean).map(line => {
          try { return JSON.parse(line); } catch { return null; }
        }).filter(Boolean).map(r => ({
          id: r.id,
          title: r.title,
          duration: r.duration,
          channel: r.channel || r.uploader,
          thumbnail: r.thumbnail || r.thumbnails?.[0]?.url,
          url: r.webpage_url || r.url,
        }));
        searchCache.set(cacheKey, { data: results, ts: Date.now() });
        resolve(results);
      });
      proc.on('error', () => resolve([]));
    });
  } finally {
    activeProcesses--;
  }
}

module.exports = { searchYouTube, searchSoundCloud, getStreamUrl };
