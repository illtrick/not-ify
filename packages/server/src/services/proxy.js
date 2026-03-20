const { ProxyAgent, fetch: undiciFetch } = require('undici');

/**
 * Returns a fetch function that routes through VPN_PROXY if configured.
 * Uses undici ProxyAgent with HTTP CONNECT — DNS resolves proxy-side.
 */
function getProxyFetch() {
  const proxy = process.env.VPN_PROXY || '';
  if (!proxy) return fetch;
  const dispatcher = new ProxyAgent(proxy);
  return (url, opts) => undiciFetch(url, { ...opts, dispatcher });
}

/**
 * Returns yt-dlp CLI args to route through proxy.
 */
function getProxyArgs() {
  const proxy = process.env.VPN_PROXY || '';
  return proxy ? ['--proxy', proxy] : [];
}

// Per-service failure tracking
const failureCounts = {};
const FAILURE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

function recordFailure(service, error) {
  if (!failureCounts[service]) failureCounts[service] = [];
  failureCounts[service].push({ time: Date.now(), error: error.substring(0, 200) });
  // Prune old entries
  const cutoff = Date.now() - FAILURE_WINDOW_MS;
  failureCounts[service] = failureCounts[service].filter(f => f.time > cutoff);
}

function getFailureSummary() {
  const cutoff = Date.now() - FAILURE_WINDOW_MS;
  const summary = {};
  for (const [service, failures] of Object.entries(failureCounts)) {
    const recent = failures.filter(f => f.time > cutoff);
    if (recent.length > 0) {
      summary[service] = {
        count: recent.length,
        lastError: recent[recent.length - 1].error,
        lastAt: recent[recent.length - 1].time,
      };
    }
  }
  return summary;
}

module.exports = { getProxyFetch, getProxyArgs, recordFailure, getFailureSummary };
