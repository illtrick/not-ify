'use strict';

const { EventEmitter } = require('events');
const { Client: SsdpClient } = require('node-ssdp');
const { UpnpMediaRendererClient } = require('upnp-client-ts');

const MEDIA_RENDERER_ST = 'urn:schemas-upnp-org:device:MediaRenderer:1';
const DEVICE_TTL_MS = 3 * 60 * 1000;  // 3 minutes
const SCAN_INTERVAL_MS = 60 * 1000;    // re-scan every 60s

// Map<usn, { usn, friendlyName, location, ip, lastSeen }>
const _devices = new Map();
let _ssdp = null;
let _scanTimer = null;
const _emitter = new EventEmitter();

// ── DIDL-Lite XML generation ──────────────────────────────────────────────────

function buildDidlLite({ title, artist, album, albumArtUrl, streamUrl, mimeType }) {
  const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return [
    '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"',
    ' xmlns:dc="http://purl.org/dc/elements/1.1/"',
    ' xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">',
    '<item id="0" parentID="-1" restricted="1">',
    `<dc:title>${esc(title)}</dc:title>`,
    `<upnp:artist>${esc(artist)}</upnp:artist>`,
    `<upnp:album>${esc(album)}</upnp:album>`,
    `<upnp:albumArtURI>${esc(albumArtUrl || '')}</upnp:albumArtURI>`,
    `<upnp:class>object.item.audioItem.musicTrack</upnp:class>`,
    `<res protocolInfo="http-get:*:${esc(mimeType)}:*">${esc(streamUrl)}</res>`,
    '</item>',
    '</DIDL-Lite>',
  ].join('');
}

// ── SSDP Discovery ────────────────────────────────────────────────────────────

function _expireDevices() {
  const now = Date.now();
  for (const [usn, device] of _devices) {
    if (now - device.lastSeen > DEVICE_TTL_MS) {
      _devices.delete(usn);
      _emitter.emit('deviceLost', { usn, friendlyName: device.friendlyName });
    }
  }
}

function _fetchFriendlyName(location) {
  return fetch(location, { signal: AbortSignal.timeout(5000) })
    .then(r => r.text())
    .then(xml => {
      const m = xml.match(/<friendlyName>([^<]+)<\/friendlyName>/);
      return m ? m[1].trim() : 'Unknown Device';
    })
    .catch(() => 'Unknown Device');
}

async function startDiscovery() {
  if (_ssdp) return; // already running

  _ssdp = new SsdpClient();

  _ssdp.on('response', async (headers, statusCode, rinfo) => {
    if (statusCode !== 200) return;
    const usn = headers.USN || headers.usn;
    const location = headers.LOCATION || headers.location;
    if (!usn || !location) return;

    const existing = _devices.get(usn);
    if (existing) {
      existing.lastSeen = Date.now();
      return;
    }

    const friendlyName = await _fetchFriendlyName(location);
    _devices.set(usn, {
      usn,
      friendlyName,
      location,
      ip: rinfo.address,
      lastSeen: Date.now(),
    });
    _emitter.emit('deviceFound', { usn, friendlyName, ip: rinfo.address });
  });

  // Initial scan
  _ssdp.search(MEDIA_RENDERER_ST);

  // Periodic re-scan + expiry
  _scanTimer = setInterval(() => {
    _expireDevices();
    _ssdp.search(MEDIA_RENDERER_ST);
  }, SCAN_INTERVAL_MS);
}

function stopDiscovery() {
  if (_ssdp) {
    _ssdp.stop();
    _ssdp = null;
  }
  if (_scanTimer) {
    clearInterval(_scanTimer);
    _scanTimer = null;
  }
}

function getDevices() {
  return Array.from(_devices.values()).map(d => ({
    usn: d.usn,
    friendlyName: d.friendlyName,
    ip: d.ip,
    location: d.location,
    lastSeen: d.lastSeen,
  }));
}

// ── Device Control ────────────────────────────────────────────────────────────

function _getClient(deviceUsn) {
  const device = _devices.get(deviceUsn);
  if (!device) throw new Error(`Device not found: ${deviceUsn}`);
  return new UpnpMediaRendererClient(device.location);
}

function secondsToHms(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function hmsToSeconds(hms) {
  if (!hms || hms === 'NOT_IMPLEMENTED') return 0;
  const parts = hms.split(':').map(Number);
  return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
}

async function play(deviceUsn, streamUrl, metadata) {
  const client = _getClient(deviceUsn);
  await client.load(streamUrl, { metadata });
  await client.play();
}

async function pause(deviceUsn) {
  const client = _getClient(deviceUsn);
  await client.pause();
}

async function stop(deviceUsn) {
  const client = _getClient(deviceUsn);
  await client.stop();
}

async function seek(deviceUsn, seconds) {
  const client = _getClient(deviceUsn);
  await client.seek(secondsToHms(seconds));
}

async function setVolume(deviceUsn, level) {
  const client = _getClient(deviceUsn);
  await client.setVolume(Math.round(Math.max(0, Math.min(100, level))));
}

async function getVolume(deviceUsn) {
  const client = _getClient(deviceUsn);
  const vol = await client.getVolume();
  return typeof vol === 'number' ? vol : parseInt(vol, 10) || 0;
}

async function getPosition(deviceUsn) {
  const client = _getClient(deviceUsn);
  const info = await client.getPositionInfo();
  return {
    position: hmsToSeconds(info.RelTime || info.AbsTime || '00:00:00'),
    duration: hmsToSeconds(info.TrackDuration || '00:00:00'),
    trackURI: info.TrackURI || '',
  };
}

async function getTransportState(deviceUsn) {
  const client = _getClient(deviceUsn);
  const info = await client.getTransportInfo();
  return info.CurrentTransportState || 'STOPPED';
}

module.exports = {
  startDiscovery,
  stopDiscovery,
  getDevices,
  buildDidlLite,
  play,
  pause,
  stop,
  seek,
  setVolume,
  getVolume,
  getPosition,
  getTransportState,
  on: (event, cb) => _emitter.on(event, cb),
  off: (event, cb) => _emitter.off(event, cb),
};
