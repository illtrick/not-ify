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

module.exports = { getProxyFetch, getProxyArgs };
