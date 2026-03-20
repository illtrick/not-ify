const fs = require('fs');
const path = require('path');
const db = require('./db');
const { getProxyFetch, recordFailure } = require('./proxy');

const CONFIG_DIR = process.env.CONFIG_DIR || '/app/config';
const CONFIG_PATH = path.join(CONFIG_DIR, 'settings.json');
const RD_BASE = 'https://api.real-debrid.com/rest/1.0';

let _cachedToken = null;

function getToken() {
  if (_cachedToken) return _cachedToken;
  // Try DB first (new path)
  const dbToken = db.getGlobalSetting('realDebridToken');
  if (dbToken && dbToken !== 'USER_PUTS_TOKEN_HERE') {
    _cachedToken = dbToken;
    return dbToken;
  }
  // Fallback: legacy config/settings.json
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    const token = config.realDebrid?.apiToken;
    if (token && token !== 'USER_PUTS_TOKEN_HERE') {
      db.setGlobalSetting('realDebridToken', token); // migrate to DB
      _cachedToken = token;
      return token;
    }
  } catch {}
  throw new Error('Real-Debrid API token not configured');
}

function setToken(token) {
  _cachedToken = token;
}

async function rdFetch(endpoint, options = {}) {
  const token = getToken();
  const url = `${RD_BASE}${endpoint}`;
  const proxyFetch = getProxyFetch();
  const res = await proxyFetch(url, {
    ...options,
    signal: AbortSignal.timeout(30000),
    headers: {
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    recordFailure('realdebrid', `${res.status} on ${endpoint}: ${body}`);
    throw new Error(`RD API error ${res.status} on ${endpoint}: ${body}`);
  }

  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

async function getUserInfo() {
  return rdFetch('/user');
}

async function addMagnet(magnetLink) {
  const body = new URLSearchParams({ magnet: magnetLink });
  const result = await rdFetch('/torrents/addMagnet', {
    method: 'POST',
    body,
  });
  return result;
}

async function selectFiles(torrentId, fileIds = 'all') {
  const body = new URLSearchParams({ files: fileIds });
  await rdFetch(`/torrents/selectFiles/${torrentId}`, {
    method: 'POST',
    body,
  });
}

async function getTorrentInfo(torrentId) {
  return rdFetch(`/torrents/info/${torrentId}`);
}

async function unrestrictLink(link) {
  const body = new URLSearchParams({ link });
  return rdFetch('/unrestrict/link', {
    method: 'POST',
    body,
  });
}

async function waitForDownload(torrentId, pollIntervalMs = 2000) {
  const timeoutMs = 5 * 60 * 1000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const info = await getTorrentInfo(torrentId);

    if (info.status === 'downloaded') {
      return info;
    }

    if (info.status === 'dead' || info.status === 'error') {
      throw new Error(`Torrent failed with status: ${info.status}`);
    }

    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error('Torrent download timed out after 5 minutes');
}

async function deleteTorrent(torrentId) {
  await rdFetch(`/torrents/delete/${torrentId}`, { method: 'DELETE' });
}

module.exports = {
  getUserInfo,
  addMagnet,
  selectFiles,
  getTorrentInfo,
  unrestrictLink,
  waitForDownload,
  deleteTorrent,
  setToken,
};
