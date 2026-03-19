'use strict';

const { EventEmitter } = require('events');
const dgram = require('dgram');
const { getLanIp } = require('./lan-ip');

const MEDIA_RENDERER_ST = 'urn:schemas-upnp-org:device:MediaRenderer:1';
const SSDP_MULTICAST = '239.255.255.250';
const SSDP_PORT = 1900;
const DEVICE_TTL_MS = 3 * 60 * 1000;  // 3 minutes
const SCAN_INTERVAL_MS = 60 * 1000;    // re-scan every 60s

const log = (...args) => console.log('[dlna]', ...args);

// Map<usn, { usn, friendlyName, location, ip, baseUrl, avTransportControl, renderingControl, lastSeen }>
const _devices = new Map();
let _socket = null;
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

// ── Raw SOAP helpers ──────────────────────────────────────────────────────────

function _soapEnvelope(serviceType, action, args) {
  const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const argsXml = Object.entries(args).map(([k, v]) => `<${k}>${esc(String(v))}</${k}>`).join('');
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">',
    '<s:Body>',
    `<u:${action} xmlns:u="${serviceType}">`,
    argsXml,
    `</u:${action}>`,
    '</s:Body>',
    '</s:Envelope>',
  ].join('');
}

async function _soapCall(controlUrl, serviceType, action, args = {}) {
  const body = _soapEnvelope(serviceType, action, args);
  const res = await fetch(controlUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPAction': `"${serviceType}#${action}"`,
    },
    body,
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text();
  if (!res.ok) {
    const errMatch = text.match(/<errorDescription>([^<]*)<\/errorDescription>/);
    throw new Error(`SOAP ${action} failed (${res.status}): ${errMatch?.[1] || text.slice(0, 200)}`);
  }
  return text;
}

function _extractXmlValue(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1] : '';
}

// ── SSDP Discovery ────────────────────────────────────────────────────────────

function _buildMSearch(st) {
  return Buffer.from([
    'M-SEARCH * HTTP/1.1',
    `HOST: ${SSDP_MULTICAST}:${SSDP_PORT}`,
    'MAN: "ssdp:discover"',
    'MX: 3',
    `ST: ${st}`,
    '', ''
  ].join('\r\n'));
}

function _parseHeaders(msg) {
  const lines = msg.toString().split('\r\n');
  const headers = {};
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      headers[line.slice(0, idx).trim().toUpperCase()] = line.slice(idx + 1).trim();
    }
  }
  return headers;
}

function _sendSearch() {
  if (!_socket) return;
  const msg = _buildMSearch(MEDIA_RENDERER_ST);
  _socket.send(msg, 0, msg.length, SSDP_PORT, SSDP_MULTICAST);
}

function _expireDevices() {
  const now = Date.now();
  for (const [usn, device] of _devices) {
    if (now - device.lastSeen > DEVICE_TTL_MS) {
      _devices.delete(usn);
      _emitter.emit('deviceLost', { usn, friendlyName: device.friendlyName });
    }
  }
}

const NON_PLAYABLE_PATTERNS = [/\bsub\b/i, /\bhue\s*bridge\b/i, /\bbridge\b/i];
const _skippedUsns = new Set();

async function _fetchDeviceInfo(location) {
  try {
    const res = await fetch(location, { signal: AbortSignal.timeout(5000) });
    const xml = await res.text();

    // Get friendly name from root device
    const nameMatch = xml.match(/<friendlyName>([^<]+)<\/friendlyName>/);
    const friendlyName = nameMatch ? nameMatch[1].trim() : 'Unknown Device';

    // Must have AVTransport somewhere
    if (!xml.includes('AVTransport')) return { friendlyName, playable: false };

    // Filter non-playable
    for (const pattern of NON_PLAYABLE_PATTERNS) {
      if (pattern.test(friendlyName)) return { friendlyName, playable: false };
    }

    // Extract base URL from location
    const urlObj = new URL(location);
    const baseUrl = `${urlObj.protocol}//${urlObj.host}`;

    // Find AVTransport control URL (could be in root or sub-device)
    const avMatch = xml.match(/<serviceType>urn:schemas-upnp-org:service:AVTransport:1<\/serviceType>[\s\S]*?<controlURL>([^<]+)<\/controlURL>/);
    const rcMatch = xml.match(/<serviceType>urn:schemas-upnp-org:service:RenderingControl:1<\/serviceType>[\s\S]*?<controlURL>([^<]+)<\/controlURL>/);

    const avTransportControl = avMatch ? baseUrl + avMatch[1] : null;
    const renderingControl = rcMatch ? baseUrl + rcMatch[1] : null;

    if (!avTransportControl) return { friendlyName, playable: false };

    return { friendlyName, playable: true, baseUrl, avTransportControl, renderingControl };
  } catch {
    return { friendlyName: 'Unknown Device', playable: false };
  }
}

async function startDiscovery() {
  if (_socket) return;

  const lanIp = getLanIp();
  log(`starting SSDP discovery on ${lanIp}...`);

  _socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  _socket.on('error', err => log('SSDP socket error:', err.message));

  _socket.on('message', async (msg, rinfo) => {
    const headers = _parseHeaders(msg);
    const usn = headers.USN;
    const location = headers.LOCATION;
    if (!usn || !location) return;

    const existing = _devices.get(usn);
    if (existing) {
      existing.lastSeen = Date.now();
      return;
    }

    const info = await _fetchDeviceInfo(location);
    if (!info.playable) {
      if (!_skippedUsns.has(usn)) {
        _skippedUsns.add(usn);
        log(`skipped non-playable device: ${info.friendlyName} (${rinfo.address})`);
      }
      return;
    }
    log(`discovered: ${info.friendlyName} (${rinfo.address})`);
    log(`  AVTransport: ${info.avTransportControl}`);
    log(`  RenderingControl: ${info.renderingControl || 'none'}`);
    _devices.set(usn, {
      usn,
      friendlyName: info.friendlyName,
      location,
      ip: rinfo.address,
      baseUrl: info.baseUrl,
      avTransportControl: info.avTransportControl,
      renderingControl: info.renderingControl,
      lastSeen: Date.now(),
    });
    _emitter.emit('deviceFound', { usn, friendlyName: info.friendlyName, ip: rinfo.address });
  });

  _socket.on('listening', () => {
    _socket.addMembership(SSDP_MULTICAST, lanIp);
    log('SSDP socket bound, sending first M-SEARCH...');
    _sendSearch();
  });

  _socket.bind(0, lanIp);

  _scanTimer = setInterval(() => {
    _expireDevices();
    _sendSearch();
  }, SCAN_INTERVAL_MS);
}

function stopDiscovery() {
  if (_socket) {
    try { _socket.close(); } catch (_) {}
    _socket = null;
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

// ── Device Control (raw SOAP) ─────────────────────────────────────────────────

const AVT = 'urn:schemas-upnp-org:service:AVTransport:1';
const RCS = 'urn:schemas-upnp-org:service:RenderingControl:1';

function _getDevice(deviceUsn) {
  const device = _devices.get(deviceUsn);
  if (!device) throw new Error(`Device not found: ${deviceUsn}`);
  return device;
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

async function play(deviceUsn, streamUrl, metadataOrOptions, startPosition) {
  const device = _getDevice(deviceUsn);
  const meta = metadataOrOptions?.metadata || {};
  log(`play: "${meta.title || '?'}" on ${device.friendlyName}${startPosition ? ` @${startPosition}s` : ''}`);
  log(`play: streamUrl=${streamUrl}`);

  const didl = buildDidlLite({
    title: meta.title || '',
    artist: meta.artist || meta.creator || '',
    album: meta.album || '',
    albumArtUrl: meta.albumArtURI || '',
    streamUrl,
    mimeType: metadataOrOptions?.contentType || 'audio/mpeg',
  });

  try {
    await _soapCall(device.avTransportControl, AVT, 'SetAVTransportURI', {
      InstanceID: 0,
      CurrentURI: streamUrl,
      CurrentURIMetaData: didl,
    });
    log('play: SetAVTransportURI OK');

    // Sonos needs time to process the URI
    await new Promise(r => setTimeout(r, 700));

    // If resuming from a position, seek BEFORE play to avoid audible restart from 0
    if (startPosition && startPosition > 2) {
      try {
        await _soapCall(device.avTransportControl, AVT, 'Seek', {
          InstanceID: 0,
          Unit: 'REL_TIME',
          Target: secondsToHms(Number(startPosition)),
        });
        log(`play: seeked to ${secondsToHms(Number(startPosition))}`);
        await new Promise(r => setTimeout(r, 300));
      } catch (seekErr) {
        log(`play: seek-before-play failed (non-fatal) — ${seekErr.message}`);
      }
    }

    await _soapCall(device.avTransportControl, AVT, 'Play', {
      InstanceID: 0,
      Speed: '1',
    });
    log('play: Play OK');
  } catch (err) {
    log(`play: FAILED — ${err.message}`);
    throw err;
  }
}

async function pause(deviceUsn) {
  const device = _getDevice(deviceUsn);
  await _soapCall(device.avTransportControl, AVT, 'Pause', { InstanceID: 0 });
}

async function resume(deviceUsn) {
  const device = _getDevice(deviceUsn);
  await _soapCall(device.avTransportControl, AVT, 'Play', { InstanceID: 0, Speed: '1' });
}

async function stop(deviceUsn) {
  const device = _getDevice(deviceUsn);
  await _soapCall(device.avTransportControl, AVT, 'Stop', { InstanceID: 0 });
}

async function seek(deviceUsn, seconds) {
  const device = _getDevice(deviceUsn);
  await _soapCall(device.avTransportControl, AVT, 'Seek', {
    InstanceID: 0,
    Unit: 'REL_TIME',
    Target: secondsToHms(Number(seconds)),
  });
}

async function setVolume(deviceUsn, level) {
  const device = _getDevice(deviceUsn);
  if (!device.renderingControl) throw new Error('No RenderingControl on device');
  await _soapCall(device.renderingControl, RCS, 'SetVolume', {
    InstanceID: 0,
    Channel: 'Master',
    DesiredVolume: Math.round(Math.max(0, Math.min(100, level))),
  });
}

async function getVolume(deviceUsn) {
  const device = _getDevice(deviceUsn);
  if (!device.renderingControl) return 0;
  const xml = await _soapCall(device.renderingControl, RCS, 'GetVolume', {
    InstanceID: 0,
    Channel: 'Master',
  });
  return parseInt(_extractXmlValue(xml, 'CurrentVolume'), 10) || 0;
}

async function getPosition(deviceUsn) {
  const device = _getDevice(deviceUsn);
  const xml = await _soapCall(device.avTransportControl, AVT, 'GetPositionInfo', { InstanceID: 0 });
  return {
    position: hmsToSeconds(_extractXmlValue(xml, 'RelTime') || _extractXmlValue(xml, 'AbsTime') || '00:00:00'),
    duration: hmsToSeconds(_extractXmlValue(xml, 'TrackDuration') || '00:00:00'),
    trackURI: _extractXmlValue(xml, 'TrackURI'),
  };
}

async function getTransportState(deviceUsn) {
  const device = _getDevice(deviceUsn);
  const xml = await _soapCall(device.avTransportControl, AVT, 'GetTransportInfo', { InstanceID: 0 });
  return _extractXmlValue(xml, 'CurrentTransportState') || 'STOPPED';
}

module.exports = {
  startDiscovery,
  stopDiscovery,
  getDevices,
  buildDidlLite,
  play,
  pause,
  resume,
  stop,
  seek,
  setVolume,
  getVolume,
  getPosition,
  getTransportState,
  on: (event, cb) => _emitter.on(event, cb),
  off: (event, cb) => _emitter.off(event, cb),
};
