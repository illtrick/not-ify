'use strict';

const { EventEmitter } = require('events');
const dgram = require('dgram');
const http = require('http');
const { getLanIp } = require('./lan-ip');

const MEDIA_RENDERER_ST = 'urn:schemas-upnp-org:device:MediaRenderer:1';
const SSDP_MULTICAST = '239.255.255.250';
const SSDP_PORT = 1900;
const DEVICE_TTL_MS = 3 * 60 * 1000;  // 3 minutes
const SCAN_INTERVAL_MS = 60 * 1000;    // re-scan every 60s

const log = (...args) => console.log('[dlna]', ...args);

// Map<usn, { usn, friendlyName, location, ip, baseUrl, avTransportControl, renderingControl, manufacturer, modelName, deviceType, lastSeen }>
const _devices = new Map();
let _socket = null;
let _scanTimer = null;
const _emitter = new EventEmitter();

// ── DIDL-Lite XML generation ──────────────────────────────────────────────────

function buildDidlLite({ title, artist, album, albumArtUrl, streamUrl, mimeType, itemId }) {
  const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return [
    '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"',
    ' xmlns:dc="http://purl.org/dc/elements/1.1/"',
    ' xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">',
    `<item id="${esc(itemId || '0')}" parentID="-1" restricted="1">`,
    `<dc:title>${esc(title)}</dc:title>`,
    `<dc:creator>${esc(artist)}</dc:creator>`,
    `<upnp:artist>${esc(artist)}</upnp:artist>`,
    `<upnp:album>${esc(album)}</upnp:album>`,
    `<upnp:albumArtURI>${esc(albumArtUrl || '')}</upnp:albumArtURI>`,
    `<upnp:class>object.item.audioItem.musicTrack</upnp:class>`,
    `<res protocolInfo="http-get:*:${esc(mimeType)}:*">${esc(streamUrl)}</res>`,
    '</item>',
    '</DIDL-Lite>',
  ].join('');
}

// Sonos DIDL-Lite with Rincon namespace — required for AddURIToQueue
// The <desc> element tells Sonos to treat this as recognized external content
function buildSonosDidlLite({ title, artist, album, albumArtUrl, streamUrl, mimeType, itemId }) {
  const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return [
    '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"',
    ' xmlns:dc="http://purl.org/dc/elements/1.1/"',
    ' xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"',
    ' xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/">',
    `<item id="${esc(itemId || '0')}" parentID="-1" restricted="1">`,
    `<dc:title>${esc(title)}</dc:title>`,
    `<dc:creator>${esc(artist)}</dc:creator>`,
    `<upnp:artist>${esc(artist)}</upnp:artist>`,
    `<upnp:album>${esc(album)}</upnp:album>`,
    `<upnp:albumArtURI>${esc(albumArtUrl || '')}</upnp:albumArtURI>`,
    `<upnp:class>object.item.audioItem.musicTrack</upnp:class>`,
    '<desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">RINCON_AssociatedZPUDN</desc>',
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

    // Find AVTransport control + event URLs (could be in root or sub-device)
    const avMatch = xml.match(/<serviceType>urn:schemas-upnp-org:service:AVTransport:1<\/serviceType>[\s\S]*?<controlURL>([^<]+)<\/controlURL>/);
    const avEventMatch = xml.match(/<serviceType>urn:schemas-upnp-org:service:AVTransport:1<\/serviceType>[\s\S]*?<eventSubURL>([^<]+)<\/eventSubURL>/);
    const rcMatch = xml.match(/<serviceType>urn:schemas-upnp-org:service:RenderingControl:1<\/serviceType>[\s\S]*?<controlURL>([^<]+)<\/controlURL>/);
    const rcEventMatch = xml.match(/<serviceType>urn:schemas-upnp-org:service:RenderingControl:1<\/serviceType>[\s\S]*?<eventSubURL>([^<]+)<\/eventSubURL>/);

    const avTransportControl = avMatch ? baseUrl + avMatch[1] : null;
    const avTransportEvent = avEventMatch ? baseUrl + avEventMatch[1] : null;
    const renderingControl = rcMatch ? baseUrl + rcMatch[1] : null;
    const renderingControlEvent = rcEventMatch ? baseUrl + rcEventMatch[1] : null;

    if (!avTransportControl) return { friendlyName, playable: false };

    // Extract manufacturer and model for device-specific behaviour
    const mfgMatch = xml.match(/<manufacturer>([^<]*)<\/manufacturer>/);
    const modelMatch = xml.match(/<modelName>([^<]*)<\/modelName>/);
    const manufacturer = mfgMatch ? mfgMatch[1].trim() : '';
    const modelName = modelMatch ? modelMatch[1].trim() : '';

    // Classify device type
    let deviceType = 'generic';
    if (/sonos/i.test(manufacturer)) deviceType = 'sonos';
    else if (/wiim|linkplay/i.test(manufacturer) || /wiim|linkplay/i.test(modelName)) deviceType = 'wiim';

    // Find WiiM PlayQueue control URL if present
    const pqMatch = xml.match(/<serviceType>urn:schemas-wiimu-com:service:PlayQueue:1<\/serviceType>[\s\S]*?<controlURL>([^<]+)<\/controlURL>/);
    const playQueueControl = pqMatch ? baseUrl + pqMatch[1] : null;

    return { friendlyName, playable: true, baseUrl, avTransportControl, avTransportEvent, renderingControl, renderingControlEvent, playQueueControl, manufacturer, modelName, deviceType };
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
    log(`discovered: ${info.friendlyName} (${rinfo.address}) [${info.deviceType}] ${info.manufacturer} ${info.modelName}`);
    log(`  AVTransport: ${info.avTransportControl}`);
    log(`  RenderingControl: ${info.renderingControl || 'none'}`);
    _devices.set(usn, {
      usn,
      friendlyName: info.friendlyName,
      location,
      ip: rinfo.address,
      baseUrl: info.baseUrl,
      avTransportControl: info.avTransportControl,
      avTransportEvent: info.avTransportEvent,
      renderingControl: info.renderingControl,
      renderingControlEvent: info.renderingControlEvent,
      playQueueControl: info.playQueueControl,
      manufacturer: info.manufacturer,
      modelName: info.modelName,
      deviceType: info.deviceType,
      usePolling: false, // set true if event subscription fails
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
    deviceType: d.deviceType,
    manufacturer: d.manufacturer,
    modelName: d.modelName,
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

async function transportNext(deviceUsn) {
  const device = _getDevice(deviceUsn);
  await _soapCall(device.avTransportControl, AVT, 'Next', { InstanceID: 0 });
}

async function transportPrevious(deviceUsn) {
  const device = _getDevice(deviceUsn);
  await _soapCall(device.avTransportControl, AVT, 'Previous', { InstanceID: 0 });
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

// ── Sonos Queue Operations ──────────────────────────────────────────────────

async function sonosClearQueue(deviceUsn) {
  const device = _getDevice(deviceUsn);
  log(`sonosClearQueue: ${device.friendlyName}`);
  await _soapCall(device.avTransportControl, AVT, 'RemoveAllTracksFromQueue', { InstanceID: 0 });
}

async function sonosAddToQueue(deviceUsn, streamUrl, metadata, { position = 0, asNext = false } = {}) {
  const device = _getDevice(deviceUsn);
  const didl = buildSonosDidlLite({
    title: metadata.title || '',
    artist: metadata.artist || metadata.creator || '',
    album: metadata.album || '',
    albumArtUrl: metadata.albumArtURI || '',
    streamUrl,
    mimeType: metadata.contentType || 'audio/mpeg',
    itemId: metadata.itemId || '0',
  });
  log(`sonosAddToQueue: "${metadata.title}" pos=${position} asNext=${asNext}`);
  const xml = await _soapCall(device.avTransportControl, AVT, 'AddURIToQueue', {
    InstanceID: 0,
    EnqueuedURI: streamUrl,
    EnqueuedURIMetaData: didl,
    DesiredFirstTrackNumberEnqueued: position,
    EnqueueAsNext: asNext ? '1' : '0',
  });
  // Extract the queue position Sonos assigned
  const trackNr = _extractXmlValue(xml, 'FirstTrackNumberEnqueued');
  log(`sonosAddToQueue: assigned position ${trackNr}`);
  return parseInt(trackNr, 10) || 1;
}

async function sonosPlayFromQueue(deviceUsn, trackNumber) {
  const device = _getDevice(deviceUsn);
  log(`sonosPlayFromQueue: track #${trackNumber} on ${device.friendlyName}`);
  // Set the queue as the transport URI, then seek to the track number
  await _soapCall(device.avTransportControl, AVT, 'SetAVTransportURI', {
    InstanceID: 0,
    CurrentURI: `x-rincon-queue:${_extractRinconId(device.usn)}#0`,
    CurrentURIMetaData: '',
  });
  await _soapCall(device.avTransportControl, AVT, 'Seek', {
    InstanceID: 0,
    Unit: 'TRACK_NR',
    Target: String(trackNumber),
  });
  await _soapCall(device.avTransportControl, AVT, 'Play', {
    InstanceID: 0,
    Speed: '1',
  });
}

function _extractRinconId(usn) {
  // USN format: uuid:RINCON_542A1B7CFA2401400_MR::... → extract RINCON_542A1B7CFA2401400
  // The _MR suffix is the sub-device identifier and must be stripped
  const m = usn.match(/uuid:(RINCON_[A-F0-9]+)/i);
  return m ? m[1] : usn.replace(/^uuid:/, '').split('::')[0];
}

// ── Sonos full-queue play: clear → add all → play from index ─────────────

async function sonosPlayQueue(deviceUsn, tracks, startIndex = 0, startPosition = 0) {
  const device = _getDevice(deviceUsn);
  log(`sonosPlayQueue: ${tracks.length} tracks, startIndex=${startIndex}, startPos=${startPosition}s on ${device.friendlyName}`);

  // Stop current playback and clear queue
  try { await stop(deviceUsn); } catch (_) {}
  await sonosClearQueue(deviceUsn);

  // Add all tracks to the Sonos queue
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    await sonosAddToQueue(deviceUsn, t.streamUrl, t.metadata, { position: 0 }); // 0 = append to end
  }

  // Play from the requested track
  await sonosPlayFromQueue(deviceUsn, startIndex + 1); // Sonos uses 1-based indexing

  // If resuming mid-track, seek after a brief delay
  if (startPosition && startPosition > 2) {
    await new Promise(r => setTimeout(r, 800));
    try {
      await seek(deviceUsn, startPosition);
      log(`sonosPlayQueue: seeked to ${secondsToHms(startPosition)}`);
    } catch (err) {
      log(`sonosPlayQueue: seek failed (non-fatal) — ${err.message}`);
    }
  }
}

// ── WiiM Linkplay PlayQueue ──────────────────────────────────────────────────

const WIIM_PQ = 'urn:schemas-wiimu-com:service:PlayQueue:1';

function _buildWiimPlaylist(tracks) {
  const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let tracksXml = '';
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const meta = t.metadata || {};
    // WiiM expects XML-escaped DIDL-Lite inside the Metadata element
    const didl = buildDidlLite({
      title: meta.title || '',
      artist: meta.artist || '',
      album: meta.album || '',
      albumArtUrl: meta.albumArtURI || '',
      streamUrl: t.streamUrl,
      mimeType: meta.contentType || 'audio/mpeg',
      itemId: meta.itemId || String(i),
    });
    tracksXml += `<Track${i + 1}>` +
      `<URL>${esc(t.streamUrl)}</URL>` +
      `<Metadata>${esc(didl)}</Metadata>` +
      `<Id>${i}</Id>` +
      `<Source>Not-ify</Source>` +
      `</Track${i + 1}>`;
  }

  return `<PlayList>` +
    `<ListName>Not-ify Queue</ListName>` +
    `<ListInfo>` +
    `<SourceName>Not-ify</SourceName>` +
    `<TrackNumber>${tracks.length}</TrackNumber>` +
    `<Quality>0</Quality>` +
    `</ListInfo>` +
    `<Tracks>${tracksXml}</Tracks>` +
    `</PlayList>`;
}

async function wiimCreateQueue(deviceUsn, tracks) {
  const device = _getDevice(deviceUsn);
  if (!device.playQueueControl) throw new Error('No PlayQueue service on device');
  const playlist = _buildWiimPlaylist(tracks);
  log(`wiimCreateQueue: ${tracks.length} tracks on ${device.friendlyName}`);
  await _soapCall(device.playQueueControl, WIIM_PQ, 'CreateQueue', {
    QueueContext: playlist,
  });
  log('wiimCreateQueue: OK');
}

async function wiimPlayQueueWithIndex(deviceUsn, index) {
  const device = _getDevice(deviceUsn);
  if (!device.playQueueControl) throw new Error('No PlayQueue service on device');
  log(`wiimPlayQueueWithIndex: index=${index} on ${device.friendlyName}`);
  await _soapCall(device.playQueueControl, WIIM_PQ, 'PlayQueueWithIndex', {
    QueueName: 'Not-ify Queue',
    Index: index,
  });
  log('wiimPlayQueueWithIndex: OK');
}

async function wiimPlayQueue(deviceUsn, tracks, startIndex = 0, startPosition = 0) {
  const device = _getDevice(deviceUsn);
  log(`wiimPlayQueue: ${tracks.length} tracks, startIndex=${startIndex} on ${device.friendlyName}`);

  try { await stop(deviceUsn); } catch (_) {}
  await wiimCreateQueue(deviceUsn, tracks);
  await wiimPlayQueueWithIndex(deviceUsn, startIndex);

  if (startPosition && startPosition > 2) {
    await new Promise(r => setTimeout(r, 800));
    try {
      await seek(deviceUsn, startPosition);
      log(`wiimPlayQueue: seeked to ${secondsToHms(startPosition)}`);
    } catch (err) {
      log(`wiimPlayQueue: seek failed (non-fatal) — ${err.message}`);
    }
  }
}

// ── UPnP Event Subscription ─────────────────────────────────────────────────

let _callbackServer = null;
let _callbackPort = 0;
const _subscriptions = new Map(); // Map<sid, { deviceUsn, service, renewTimer }>
const _deviceState = new Map(); // Map<deviceUsn, { transportState, trackURI, volume }>

function _parseLastChange(xml) {
  // LastChange is XML-escaped inside the event XML, so we need to unescape first
  const lcMatch = xml.match(/<LastChange>([^]*?)<\/LastChange>/);
  if (!lcMatch) return {};
  let lc = lcMatch[1]
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');

  const result = {};
  const valMatch = (tag) => {
    const m = lc.match(new RegExp(`<${tag}\\s+val="([^"]*)"`, 'i'));
    return m ? m[1] : undefined;
  };

  result.transportState = valMatch('TransportState');
  result.currentTrackURI = valMatch('CurrentTrackURI');
  result.currentTrackMetaData = valMatch('CurrentTrackMetaData');
  result.volume = valMatch('Volume');

  // AVTransport CurrentTrackDuration
  result.currentTrackDuration = valMatch('CurrentTrackDuration');

  return result;
}

async function _startCallbackServer() {
  if (_callbackServer) return _callbackPort;

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'NOTIFY') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          const sid = req.headers.sid;
          const sub = _subscriptions.get(sid);
          if (sub) {
            const changes = _parseLastChange(body);
            const prev = _deviceState.get(sub.deviceUsn) || {};

            if (sub.service === 'AVTransport') {
              if (changes.transportState && changes.transportState !== prev.transportState) {
                log(`event: ${sub.deviceUsn.slice(0, 30)} transportState: ${prev.transportState} → ${changes.transportState}`);
                prev.transportState = changes.transportState;
                _emitter.emit('transportStateChanged', { deviceUsn: sub.deviceUsn, state: changes.transportState });
              }
              if (changes.currentTrackURI && changes.currentTrackURI !== prev.trackURI) {
                log(`event: track changed on ${sub.deviceUsn.slice(0, 30)}`);
                prev.trackURI = changes.currentTrackURI;
                _emitter.emit('trackChanged', { deviceUsn: sub.deviceUsn, trackURI: changes.currentTrackURI });
              }
            }
            if (sub.service === 'RenderingControl' && changes.volume !== undefined) {
              const vol = parseInt(changes.volume, 10);
              if (!isNaN(vol) && vol !== prev.volume) {
                prev.volume = vol;
                _emitter.emit('volumeChanged', { deviceUsn: sub.deviceUsn, volume: vol });
              }
            }
            _deviceState.set(sub.deviceUsn, prev);
          }
          res.writeHead(200);
          res.end();
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    server.on('error', err => {
      log(`callback server error: ${err.message}`);
      reject(err);
    });

    // Listen on port 0 to get a free port
    server.listen(0, getLanIp(), () => {
      _callbackServer = server;
      _callbackPort = server.address().port;
      log(`UPnP callback server listening on ${getLanIp()}:${_callbackPort}`);
      resolve(_callbackPort);
    });
  });
}

async function subscribe(deviceUsn) {
  const device = _getDevice(deviceUsn);
  const lanIp = getLanIp();
  const port = await _startCallbackServer();
  const callbackBase = `http://${lanIp}:${port}`;

  const services = [];
  if (device.avTransportEvent) services.push({ url: device.avTransportEvent, name: 'AVTransport' });
  if (device.renderingControlEvent) services.push({ url: device.renderingControlEvent, name: 'RenderingControl' });

  // Initialize device state
  if (!_deviceState.has(deviceUsn)) _deviceState.set(deviceUsn, {});

  for (const svc of services) {
    try {
      const res = await fetch(svc.url, {
        method: 'SUBSCRIBE',
        headers: {
          CALLBACK: `<${callbackBase}/upnp/event/${encodeURIComponent(deviceUsn)}>`,
          NT: 'upnp:event',
          TIMEOUT: 'Second-300',
        },
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        log(`subscribe: ${svc.name} failed (${res.status}) for ${device.friendlyName}`);
        device.usePolling = true;
        continue;
      }

      const sid = res.headers.get('sid');
      if (!sid) {
        log(`subscribe: no SID returned for ${svc.name} on ${device.friendlyName}`);
        device.usePolling = true;
        continue;
      }

      log(`subscribe: ${svc.name} OK for ${device.friendlyName} (SID=${sid.slice(0, 20)}...)`);

      // Auto-renew every 250s (timeout is 300s)
      const renewTimer = setInterval(async () => {
        try {
          await fetch(svc.url, {
            method: 'SUBSCRIBE',
            headers: { SID: sid, TIMEOUT: 'Second-300' },
            signal: AbortSignal.timeout(5000),
          });
        } catch (err) {
          log(`subscribe: renew failed for ${svc.name} on ${device.friendlyName}: ${err.message}`);
          device.usePolling = true;
        }
      }, 250000);

      _subscriptions.set(sid, { deviceUsn, service: svc.name, renewTimer });
    } catch (err) {
      log(`subscribe: ${svc.name} error for ${device.friendlyName}: ${err.message}`);
      device.usePolling = true;
    }
  }
}

async function unsubscribe(deviceUsn) {
  for (const [sid, sub] of _subscriptions) {
    if (sub.deviceUsn === deviceUsn) {
      clearInterval(sub.renewTimer);
      _subscriptions.delete(sid);
      // Best-effort UNSUBSCRIBE
      const device = _devices.get(deviceUsn);
      if (device) {
        const eventUrl = sub.service === 'AVTransport' ? device.avTransportEvent : device.renderingControlEvent;
        if (eventUrl) {
          try {
            await fetch(eventUrl, { method: 'UNSUBSCRIBE', headers: { SID: sid }, signal: AbortSignal.timeout(3000) });
          } catch (_) {}
        }
      }
    }
  }
  _deviceState.delete(deviceUsn);
}

function getDeviceState(deviceUsn) {
  return _deviceState.get(deviceUsn) || null;
}

function isUsingPolling(deviceUsn) {
  const device = _devices.get(deviceUsn);
  return device?.usePolling !== false;
}

// ── Gapless: SetNextAVTransportURI ──────────────────────────────────────────

async function setNextTrack(deviceUsn, streamUrl, metadata) {
  const device = _getDevice(deviceUsn);
  const didl = device.deviceType === 'sonos'
    ? buildSonosDidlLite({ title: metadata.title || '', artist: metadata.artist || '', album: metadata.album || '', albumArtUrl: metadata.albumArtURI || '', streamUrl, mimeType: metadata.contentType || 'audio/mpeg', itemId: metadata.itemId || '0' })
    : buildDidlLite({ title: metadata.title || '', artist: metadata.artist || '', album: metadata.album || '', albumArtUrl: metadata.albumArtURI || '', streamUrl, mimeType: metadata.contentType || 'audio/mpeg', itemId: metadata.itemId || '0' });

  try {
    await _soapCall(device.avTransportControl, AVT, 'SetNextAVTransportURI', {
      InstanceID: 0,
      NextURI: streamUrl,
      NextURIMetaData: didl,
    });
    log(`setNextTrack: OK for ${device.friendlyName}`);
    return true;
  } catch (err) {
    log(`setNextTrack: failed (non-fatal) — ${err.message}`);
    return false;
  }
}

// Get the device type for a given USN
function getDeviceType(deviceUsn) {
  const device = _devices.get(deviceUsn);
  return device?.deviceType || 'generic';
}

module.exports = {
  startDiscovery,
  stopDiscovery,
  getDevices,
  getDeviceType,
  buildDidlLite,
  buildSonosDidlLite,
  play,
  pause,
  resume,
  stop,
  seek,
  setVolume,
  getVolume,
  getPosition,
  getTransportState,
  setNextTrack,
  sonosClearQueue,
  sonosAddToQueue,
  sonosPlayFromQueue,
  sonosPlayQueue,
  transportNext,
  transportPrevious,
  wiimCreateQueue,
  wiimPlayQueueWithIndex,
  wiimPlayQueue,
  subscribe,
  unsubscribe,
  getDeviceState,
  isUsingPolling,
  on: (event, cb) => _emitter.on(event, cb),
  off: (event, cb) => _emitter.off(event, cb),
};
