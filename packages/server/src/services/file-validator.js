'use strict';

// childProcess and fs are referenced via the module object so Jest spies intercept calls
const childProcess = require('child_process');
const fs = require('fs');
const net = require('net');

const CLAM_SOCKET = process.env.CLAM_SOCKET || '/var/run/clamav/clamd.sock'; // eslint-disable-line no-unused-vars
const MAX_AUDIO_SIZE = 500 * 1024 * 1024; // 500 MB
const CLAM_CHUNK_SIZE = 64 * 1024; // 64 KB chunks for INSTREAM

let _toolStatus = null;

const AUDIO_MIMES = new Set([
  'audio/mpeg', 'audio/flac', 'audio/ogg', 'audio/mp4',
  'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/opus',
  'audio/x-flac', 'audio/x-m4a', 'audio/x-aiff',
]);

function isClamEnabled() {
  return process.env.CLAM_ENABLED !== 'false';
}

function isMimeCheckEnabled() {
  // Defaults to enabled; set MIME_CHECK_ENABLED=false on Windows dev where `file` may not exist
  return process.env.MIME_CHECK_ENABLED !== 'false';
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

function checkFileSize(filePath) {
  const { size } = fs.statSync(filePath);
  const passed = size <= MAX_AUDIO_SIZE;
  return { name: 'size', passed, detail: formatBytes(size) };
}

function checkMimeType(filePath) {
  try {
    const raw = childProcess.execSync(`file --mime-type -b "${filePath}"`).toString().trim();
    const passed = AUDIO_MIMES.has(raw);
    return { name: 'mime', passed, detail: raw };
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    // If `file` command isn't installed, skip rather than fail
    if (msg.includes('enoent') || msg.includes('not found') || msg.includes('no such file')) {
      return { name: 'mime', skipped: true, detail: '`file` command not available' };
    }
    return { name: 'mime', passed: false, detail: err.message };
  }
}

function checkFfprobe(filePath) {
  try {
    const raw = childProcess.execSync(
      `ffprobe -v error -show_format -of json "${filePath}"`
    ).toString();
    const parsed = JSON.parse(raw);
    const fmt = parsed.format || {};
    const detail = [
      fmt.format_name,
      fmt.bit_rate ? Math.round(fmt.bit_rate / 1000) + 'kbps' : null,
    ].filter(Boolean).join(', ');
    return { name: 'ffprobe', passed: true, detail: detail || 'ok' };
  } catch (err) {
    return { name: 'ffprobe', passed: false, detail: err.message };
  }
}

function checkClamAVviaTCP(filePath) {
  return new Promise((resolve) => {
    const host = process.env.CLAM_HOST || 'clamav';
    const port = parseInt(process.env.CLAM_PORT || '3310', 10);
    const socket = new net.Socket();
    let response = '';

    socket.setTimeout(30000);

    socket.on('error', (err) => {
      resolve({ name: 'clam', passed: false, detail: `TCP error: ${err.message}` });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({ name: 'clam', passed: false, detail: 'TCP timeout' });
    });

    socket.connect(port, host, () => {
      // Send INSTREAM command (null-terminated)
      socket.write('zINSTREAM\0');

      // Stream file in chunks
      let fd;
      try {
        fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(CLAM_CHUNK_SIZE);
        let bytesRead;
        while ((bytesRead = fs.readSync(fd, buf, 0, CLAM_CHUNK_SIZE, null)) > 0) {
          const sizeHeader = Buffer.allocUnsafe(4);
          sizeHeader.writeUInt32BE(bytesRead, 0);
          socket.write(sizeHeader);
          socket.write(buf.slice(0, bytesRead));
        }
        fs.closeSync(fd);
      } catch (err) {
        if (fd !== undefined) {
          try { fs.closeSync(fd); } catch (_) { /* ignore */ }
        }
        socket.destroy();
        resolve({ name: 'clam', passed: false, detail: `Read error: ${err.message}` });
        return;
      }

      // Send end-of-stream (4 zero bytes)
      socket.write(Buffer.alloc(4));
    });

    socket.on('data', (data) => {
      response += data.toString();
    });

    socket.on('end', () => {
      // Response is like "stream: OK\0" or "stream: Win.Test.EICAR FOUND\0"
      const clean = response.replace(/\0/g, '').trim();
      if (clean.endsWith('OK')) {
        resolve({ name: 'clam', passed: true, detail: 'clean' });
      } else {
        resolve({ name: 'clam', passed: false, detail: clean || 'infected' });
      }
    });
  });
}

async function checkClamAV(filePath) {
  if (!isClamEnabled()) {
    return { name: 'clam', skipped: true, detail: 'ClamAV disabled' };
  }

  // If CLAM_HOST is set, use TCP INSTREAM protocol (Docker/daemon mode)
  if (process.env.CLAM_HOST) {
    return checkClamAVviaTCP(filePath);
  }

  // Fallback: clamdscan CLI (local daemon or socket)
  try {
    childProcess.execSync(`clamdscan --no-summary "${filePath}"`);
    return { name: 'clam', passed: true, detail: 'clean' };
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    // If ClamAV daemon/CLI isn't available, skip rather than fail
    if (msg.includes('enoent') || msg.includes('not found') || msg.includes('no such file')
        || msg.includes('connection refused') || msg.includes('could not connect')) {
      return { name: 'clam', skipped: true, detail: 'ClamAV not available' };
    }
    return { name: 'clam', passed: false, detail: err.message || 'infected' };
  }
}

/**
 * Validate a downloaded audio file.
 * @param {string} filePath — path to the file
 * @param {object} [opts]
 * @param {boolean} [opts.deferClam=false] — if true, skip ClamAV in this call
 *   (caller is responsible for running scanClamAV() async afterward).
 *   Use for initial downloads where streaming speed matters.
 *   Always run sync (deferClam=false) for upgrades that replace existing files.
 */
async function validateFile(filePath, opts = {}) {
  const results = { path: filePath, passed: true, checks: [] };

  // 1. Size check
  const sizeCheck = checkFileSize(filePath);
  results.checks.push(sizeCheck);
  if (!sizeCheck.passed) {
    results.passed = false;
    // Return early — no point running further checks on an oversized file
    return results;
  }

  // 2. MIME type check (skippable on Windows dev where `file` may not be installed)
  if (isMimeCheckEnabled()) {
    const mimeCheck = checkMimeType(filePath);
    results.checks.push(mimeCheck);
    if (!mimeCheck.skipped && !mimeCheck.passed) {
      results.passed = false;
    }
  }

  // 3. ffprobe validation — confirms file is valid, parseable audio
  const ffprobeCheck = checkFfprobe(filePath);
  results.checks.push(ffprobeCheck);
  if (!ffprobeCheck.passed) {
    results.passed = false;
  }

  // 4. ClamAV scan — sync for upgrades, deferred for initial downloads
  if (!opts.deferClam) {
    const clamCheck = await checkClamAV(filePath);
    results.checks.push(clamCheck);
    if (!clamCheck.skipped && !clamCheck.passed) {
      results.passed = false;
    }
  } else {
    results.checks.push({ name: 'clam', skipped: true, detail: 'deferred (async)' });
  }

  const _mime = results.checks.find(c => c.name === 'mime');
  const _ffprobe = results.checks.find(c => c.name === 'ffprobe');
  const _clam = results.checks.find(c => c.name === 'clam');
  _toolStatus = {
    file: _mime ? !_mime.skipped : null,
    ffprobe: _ffprobe ? !_ffprobe.skipped : null,
    clamdscan: _clam ? !_clam.skipped : null,
  };

  return results;
}

/**
 * Run ClamAV scan independently. Use after validateFile({ deferClam: true }).
 * Returns the clam check result. If the file fails, caller should remove it.
 */
async function scanClamAV(filePath) {
  return checkClamAV(filePath);
}

function getStatus() {
  return {
    toolsProbed: _toolStatus !== null,
    tools: _toolStatus || { file: 'untested', ffprobe: 'untested', clamdscan: 'untested' },
  };
}

module.exports = {
  validateFile,
  scanClamAV,
  getStatus,
  _test: { checkMimeType, checkFfprobe, checkFileSize, checkClamAV },
};
