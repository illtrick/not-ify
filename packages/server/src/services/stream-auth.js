'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CONFIG_DIR = process.env.CONFIG_DIR || '/app/config';
const KEY_FILE = path.join(CONFIG_DIR, 'stream.key');

let _key = null;

function getKey() {
  if (_key) return _key;
  if (fs.existsSync(KEY_FILE)) {
    _key = fs.readFileSync(KEY_FILE, 'utf8').trim();
  } else {
    _key = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(KEY_FILE, _key, 'utf8');
  }
  return _key;
}

function sign(id, exp) {
  return crypto.createHmac('sha256', getKey()).update(`${id}:${exp}`).digest('hex');
}

function generateSignedUrl(id, baseUrl, ttlSeconds = 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = sign(id, exp);
  return `${baseUrl}/api/stream/${id}?sig=${sig}&exp=${exp}`;
}

function generateSignedYtUrl(videoId, baseUrl, ttlSeconds = 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = sign(videoId, exp);
  return `${baseUrl}/api/yt/stream/${videoId}?sig=${sig}&exp=${exp}`;
}

function verifySignature(id, sig, exp) {
  const now = Math.floor(Date.now() / 1000);
  if (!sig || !exp || parseInt(exp, 10) < now) return false;
  // Pre-validate hex format to prevent Buffer.from(sig, 'hex') from throwing or
  // silently producing a wrong-length buffer on malformed input (S10).
  if (!/^[0-9a-f]+$/i.test(sig)) return false;
  const expected = sign(id, exp);
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

module.exports = { generateSignedUrl, generateSignedYtUrl, verifySignature };
